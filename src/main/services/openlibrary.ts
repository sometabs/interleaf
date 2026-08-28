// Nothing here throws on a network problem: offline is a normal state.

import { READING_LANGUAGES } from '../../shared/languages'
import { createThrottle } from '../lib/throttle'
import { latinAuthorName } from './authorNames'

const BASE = 'https://openlibrary.org'
const COVERS = 'https://covers.openlibrary.org'

// A contact address here would raise the allowance from 1 to 3 req/sec.
const UA = 'Interleaf/1.0 (personal reading journal; offline-first)'

// A search carrying `editions` runs ~6s, and has been seen at 21s.
const TIMEOUT_MS = 25000

// 1 req/sec for unidentified clients. Cover downloads bypass this: only
// ISBN/OCLC/LCCN lookups are rate-limited there, never cover ids.
const throttle = createThrottle(1100)

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// `fetch` throws a bare "fetch failed" and puts the real reason on `cause`.
function describeFailure(err: unknown): string {
  const error = err as { name?: string; message?: string; cause?: { code?: string } }
  const code = error?.cause?.code
  return code ? `${error.name}: ${error.message} (${code})` : `${error?.name}: ${error?.message}`
}

export interface OlBook {
  olid: string
  title: string
  author: string | null
  firstPublishYear: number | null
  coverId: number | null
  isbn: string | null
  pageCount: number | null
  subjects: string[]
  // Languages this work has an edition in, not the language it was written in.
  languages: string[]
}

export interface OlWorkDetail {
  title: string | null
  description: string | null
  subjects: string[]
  // Attached to the work itself, used when search gave us none.
  covers: number[]
  raw: unknown
}

async function getJson<T>(url: string): Promise<T | null> {
  return throttle(async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(url, {
          headers: { 'User-Agent': UA, Accept: 'application/json' },
          signal: AbortSignal.timeout(TIMEOUT_MS)
        })

        if (res.status === 429 || res.status === 503) {
          if (attempt === 1) return null
          const retryAfter = Number(res.headers.get('retry-after'))
          const waitMs =
            Number.isFinite(retryAfter) && retryAfter > 0
              ? Math.min(retryAfter * 1000, 15000)
              : 3000
          console.warn(`[openlibrary] ${res.status} from ${url}; backing off ${waitMs}ms`)
          await sleep(waitMs)
          continue
        }

        if (!res.ok) {
          console.warn(`[openlibrary] ${res.status} ${res.statusText} from ${url}`)
          return null
        }
        return (await res.json()) as T
      } catch (err) {
        // Null to the caller but logged: the cause is the only way to tell
        // "Open Library is down" from "this app is broken".
        console.warn(`[openlibrary] ${describeFailure(err)} for ${url}`)
        return null
      }
    }
    return null
  })
}

function toOlid(key: string | undefined): string | null {
  if (!key) return null
  return key.replace(/^\/works\//, '').trim() || null
}

// A /search.json document. /subjects/ spells these differently (`cover_id`,
// `authors: [{name}]`), so a call moved there needs its own mapping.
interface SearchDoc {
  key?: string
  title?: string
  author_name?: string[]
  // Flat across every author: nothing says which name is whose.
  author_alternative_name?: string[]
  first_publish_year?: number
  cover_i?: number
  isbn?: string[]
  number_of_pages_median?: number
  subject?: string[]
  language?: string[]
  // Requesting a sub-field requires requesting bare `editions` too.
  editions?: { docs?: { title?: string; cover_i?: number; isbn?: string[] }[] }
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
}

interface Display {
  title: string
  coverId: number | null
  isbn: string | null
}

// Containment, not language detection: the work title is kept only when every
// one of its words appears in the edition's. Never mix the two sources.
function display(doc: SearchDoc): Display {
  const work = {
    title: (doc.title ?? '').trim(),
    coverId: doc.cover_i ?? null,
    isbn: doc.isbn?.[0] ?? null
  }

  const edition = doc.editions?.docs?.[0]
  if (!edition) return work
  const editionTitle = edition.title?.trim()
  if (!editionTitle) return work

  const inEdition = new Set(words(editionTitle))
  const workWords = words(work.title)
  if (workWords.length > 0 && workWords.every((word) => inEdition.has(word))) return work

  // No fallback to the work's cover or ISBN: that reintroduces the mismatch.
  return { title: editionTitle, coverId: edition.cover_i ?? null, isbn: edition.isbn?.[0] ?? null }
}

function displayAuthor(doc: SearchDoc): string | null {
  const names = (doc.author_name ?? []).map((name) => name.trim()).filter(Boolean)
  if (names.length === 0) return null
  return latinAuthorName(names[0], doc.author_alternative_name ?? [], names.slice(1))
}

export function toOlBook(doc: SearchDoc): OlBook | null {
  const olid = toOlid(doc.key)
  if (!olid || !doc.title) return null

  const shown = display(doc)

  return {
    // Always the work id: `/works/{editionId}.json` answers 200 with the
    // edition record rather than 404, so getting it wrong fails silently.
    olid,
    title: shown.title,
    author: displayAuthor(doc),
    firstPublishYear: doc.first_publish_year ?? null,
    coverId: shown.coverId,
    isbn: shown.isbn,
    pageCount: doc.number_of_pages_median ?? null,
    subjects: doc.subject?.slice(0, 40) ?? [],
    languages: (doc.language ?? []).slice(0, 12)
  }
}

// Repeating the parameter is an OR, not an AND.
function languageFilter(codes: readonly string[]): string {
  return codes.map((code) => `&language=${encodeURIComponent(code)}`).join('')
}

// `null` when the request failed, `[]` when Open Library answered with nothing:
// collapsing them shows a timeout as "no such book".
export async function searchBooks(
  query: string,
  limit = 12,
  languages: readonly string[] = READING_LANGUAGES
): Promise<OlBook[] | null> {
  const q = query.trim()
  if (!q) return []

  const fields = [
    'key',
    'title',
    'author_name',
    'author_alternative_name',
    'first_publish_year',
    'cover_i',
    'isbn',
    'number_of_pages_median',
    'subject',
    'language',
    'editions',
    'editions.title',
    'editions.cover_i',
    'editions.isbn'
  ].join(',')

  const url =
    `${BASE}/search.json?q=${encodeURIComponent(q)}&limit=${limit}&fields=${fields}` +
    languageFilter(languages)
  const data = await getJson<{ docs?: SearchDoc[] }>(url)
  if (data === null) return null

  return (data.docs ?? []).map(toOlBook).filter((b): b is OlBook => b !== null)
}

interface WorkResponse {
  title?: string
  description?: string | { value?: string }
  subjects?: string[]
  covers?: number[]
}

// The only reliable way to resolve an OLID: `q=` does not match work ids.
export async function fetchWork(olid: string): Promise<OlWorkDetail | null> {
  const data = await getJson<WorkResponse>(`${BASE}/works/${encodeURIComponent(olid)}.json`)
  if (!data) return null

  const description =
    typeof data.description === 'string' ? data.description : (data.description?.value ?? null)

  return {
    title: data.title ?? null,
    description,
    subjects: data.subjects ?? [],
    covers: (data.covers ?? []).filter((id) => id > 0),
    raw: data
  }
}

// Via search rather than /subjects/{slug}.json, which reports no language and
// accepts no language filter. `sort=editions` replaces its curated ordering.
export async function fetchSubject(
  subject: string,
  limit = 24,
  languages: readonly string[] = READING_LANGUAGES
): Promise<OlBook[]> {
  const s = subject.trim()
  if (!s) return []

  const fields = [
    'key',
    'title',
    'author_name',
    'author_alternative_name',
    'first_publish_year',
    'cover_i',
    'subject',
    'language',
    'editions',
    'editions.title',
    'editions.cover_i'
  ].join(',')

  const q = `subject:"${s.replace(/"/g, '')}"`
  const url =
    `${BASE}/search.json?q=${encodeURIComponent(q)}&limit=${limit}` +
    `&sort=editions&fields=${fields}${languageFilter(languages)}`

  const data = await getJson<{ docs?: SearchDoc[] }>(url)

  return (data?.docs ?? []).map(toOlBook).filter((b): b is OlBook => b !== null)
}

export async function fetchByAuthor(
  author: string,
  limit = 16,
  languages: readonly string[] = READING_LANGUAGES
): Promise<OlBook[]> {
  const a = author.trim()
  if (!a) return []

  const fields = [
    'key',
    'title',
    'author_name',
    'author_alternative_name',
    'first_publish_year',
    'cover_i',
    'subject',
    'language',
    'editions',
    'editions.title',
    'editions.cover_i'
  ].join(',')
  const url =
    `${BASE}/search.json?author=${encodeURIComponent(a)}&limit=${limit}&fields=${fields}` +
    languageFilter(languages)
  const data = await getJson<{ docs?: SearchDoc[] }>(url)

  return (data?.docs ?? []).map(toOlBook).filter((b): b is OlBook => b !== null)
}

function coverUrl(coverId: number, size: 'S' | 'M' | 'L' = 'M'): string {
  return `${COVERS}/b/id/${coverId}-${size}.jpg`
}

export async function downloadCover(
  coverId: number,
  size: 'S' | 'M' | 'L' = 'L'
): Promise<Buffer | null> {
  // This id arrives as an IPC argument, so `number` says nothing at runtime and
  // `../` in it would rewrite the request path.
  if (!Number.isInteger(coverId) || coverId <= 0) return null

  try {
    const res = await fetch(coverUrl(coverId, size), {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
    if (!res.ok) return null

    const buf = Buffer.from(await res.arrayBuffer())
    return buf.byteLength > 1000 ? buf : null
  } catch {
    return null
  }
}
