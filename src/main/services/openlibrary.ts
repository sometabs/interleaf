// Nothing here throws on a network problem: offline is a normal state.

import { createThrottle } from '../lib/throttle'
import { latinAuthorName } from './authorNames'

const BASE = 'https://openlibrary.org'
const COVERS = 'https://covers.openlibrary.org'

// A contact address here would raise the allowance from 1 to 3 req/sec.
const UA = 'Interleaf/1.0 (personal reading journal; offline-first)'

// A search carrying `editions` runs ~6s, and has been seen at 21s.
const TIMEOUT_MS = 25000
const STATUS_TIMEOUT_MS = 10000

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

// A single small Search API request: reaching the home page would not prove
// that the catalogue endpoint used by Interleaf is healthy.
export async function checkAvailability(): Promise<boolean> {
  return throttle(async () => {
    const url = `${BASE}/search.json?q=key%3A%2Fworks%2FOL45804W&limit=1&fields=key`
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        signal: AbortSignal.timeout(STATUS_TIMEOUT_MS)
      })
      return response.ok
    } catch (err) {
      console.warn(`[openlibrary] status check failed: ${describeFailure(err)}`)
      return false
    }
  })
}

export interface OlBook {
  olid: string
  editionOlid: string | null
  title: string
  author: string | null
  publishedYear: number | null
  coverId: number | null
  isbn: string | null
  pageCount: number | null
  subjects: string[]
  // The Search API does not expose full work descriptions, but frequently
  // carries a first sentence that gives candidates useful text to compare.
  description: string | null
  // Languages this work has an edition in, not the language it was written in.
  languages: string[]
}

// Work-only fields used by metadata refresh. Keeping this separate from
// OlBook prevents an arbitrary nested edition from becoming a saved book.
export interface OlWorkRefresh {
  olid: string
  publishedYear: number | null
  pageCount: number | null
  subjects: string[]
  description: string | null
}

export interface OlWorkDetail {
  description: string | null
  subjects: string[]
  raw: unknown
}

type JsonResult<T> = { kind: 'ok'; value: T } | { kind: 'missing' } | { kind: 'unavailable' }

async function requestJson<T>(url: string): Promise<JsonResult<T>> {
  return throttle(async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(url, {
          headers: { 'User-Agent': UA, Accept: 'application/json' },
          signal: AbortSignal.timeout(TIMEOUT_MS)
        })

        if (res.status === 429 || res.status === 503) {
          if (attempt === 1) return { kind: 'unavailable' }
          const retryAfter = Number(res.headers.get('retry-after'))
          const waitMs =
            Number.isFinite(retryAfter) && retryAfter > 0
              ? Math.min(retryAfter * 1000, 15000)
              : 3000
          console.warn(`[openlibrary] ${res.status} from ${url}; backing off ${waitMs}ms`)
          await sleep(waitMs)
          continue
        }

        if (res.status === 404) return { kind: 'missing' }
        if (!res.ok) {
          console.warn(`[openlibrary] ${res.status} ${res.statusText} from ${url}`)
          return { kind: 'unavailable' }
        }
        return { kind: 'ok', value: (await res.json()) as T }
      } catch (err) {
        // Null to the caller but logged: the cause is the only way to tell
        // "Open Library is down" from "this app is broken".
        console.warn(`[openlibrary] ${describeFailure(err)} for ${url}`)
        return { kind: 'unavailable' }
      }
    }
    return { kind: 'unavailable' }
  })
}

async function getJson<T>(url: string): Promise<T | null> {
  const result = await requestJson<T>(url)
  return result.kind === 'ok' ? result.value : null
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
  first_sentence?: string | string[]
  language?: string[]
  // Requesting a sub-field requires requesting bare `editions` too.
  editions?: {
    docs?: {
      key?: string
      title?: string
      cover_i?: number
      isbn?: string[]
      language?: string[]
      number_of_pages?: number
      publish_date?: string | string[]
    }[]
  }
}

function responseDocs(data: { docs?: unknown }): SearchDoc[] | null {
  return Array.isArray(data.docs) ? (data.docs as SearchDoc[]) : null
}

function firstSentence(doc: SearchDoc): string | null {
  const value = Array.isArray(doc.first_sentence) ? doc.first_sentence[0] : doc.first_sentence
  return value?.trim() || null
}

interface Display {
  title: string
  coverId: number | null
  isbn: string | null
  editionOlid: string | null
  pageCount: number | null
  publishedYear: number | null
  languages: string[]
}

function toEditionOlid(key: string | undefined): string | null {
  const match = key?.trim().match(/^\/books\/(OL\d+M)$/i)
  return match?.[1] ?? null
}

// Open Library's search display combines the chosen edition's title and cover
// with the work's first publication year. Keep that same combination here;
// page count remains the work median, with the edition only as a fallback.
function display(doc: SearchDoc): Display {
  const edition = doc.editions?.docs?.[0]
  return {
    title: edition?.title?.trim() || (doc.title ?? '').trim(),
    coverId: edition?.cover_i ?? doc.cover_i ?? null,
    isbn: edition?.isbn?.[0] ?? doc.isbn?.[0] ?? null,
    editionOlid: toEditionOlid(edition?.key),
    pageCount: doc.number_of_pages_median ?? edition?.number_of_pages ?? null,
    publishedYear: doc.first_publish_year ?? null,
    languages: edition?.language?.length ? [...edition.language] : [...(doc.language ?? [])]
  }
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
    editionOlid: shown.editionOlid,
    title: shown.title,
    author: displayAuthor(doc),
    publishedYear: shown.publishedYear,
    coverId: shown.coverId,
    isbn: shown.isbn,
    pageCount: shown.pageCount,
    subjects: [...(doc.subject ?? [])],
    description: firstSentence(doc),
    languages: shown.languages
  }
}

const SEARCH_FIELDS = [
  'key',
  'title',
  'author_name',
  'author_alternative_name',
  'first_publish_year',
  'cover_i',
  'number_of_pages_median',
  'subject',
  'first_sentence',
  'language',
  'editions',
  'editions.key',
  'editions.title',
  'editions.cover_i',
  'editions.isbn',
  'editions.language',
  'editions.number_of_pages'
].join(',')

// `null` when the request failed, `[]` when Open Library answered with nothing:
// collapsing them shows a timeout as "no such book".
export async function searchBooks(query: string, limit = 12): Promise<OlBook[] | null> {
  const q = query.trim()
  if (!q) return []

  const url = `${BASE}/search.json?q=${encodeURIComponent(q)}&limit=${limit}&fields=${SEARCH_FIELDS}`
  const data = await getJson<{ docs?: unknown }>(url)
  if (data === null) return null
  const docs = responseDocs(data)
  if (docs === null) return null

  return docs.map(toOlBook).filter((b): b is OlBook => b !== null)
}

const WORK_REFRESH_FIELDS = [
  'key',
  'first_publish_year',
  'number_of_pages_median',
  'subject',
  'first_sentence'
].join(',')

function toOlWorkRefresh(doc: SearchDoc): OlWorkRefresh | null {
  const olid = toOlid(doc.key)
  if (!olid) return null
  return {
    olid,
    publishedYear: doc.first_publish_year ?? null,
    pageCount: doc.number_of_pages_median ?? null,
    subjects: [...(doc.subject ?? [])],
    description: firstSentence(doc)
  }
}

// Refresh asks only for work-level values. It deliberately does not request
// editions, so refreshing cannot silently select a different one.
export async function searchWorkByOlid(olid: string): Promise<OlWorkRefresh[] | null> {
  const id = olid.trim().toUpperCase()
  if (!/^OL\d+W$/.test(id)) return []

  const q = `key:/works/${id}`
  const url = `${BASE}/search.json?q=${encodeURIComponent(q)}&limit=1&fields=${WORK_REFRESH_FIELDS}`
  const data = await getJson<{ docs?: unknown }>(url)
  if (data === null) return null
  const docs = responseDocs(data)
  if (docs === null) return null
  return docs.map(toOlWorkRefresh).filter((b): b is OlWorkRefresh => b !== null)
}

// A raw, fielded Search API query for Discover. Unlike the older one-subject
// harvest this keeps Open Library's relevance order and preserves `null`, so a
// partial outage cannot replace a healthy cached pool with an incomplete one.
export async function fetchCandidates(query: string, limit = 50): Promise<OlBook[] | null> {
  const q = query.trim()
  if (!q) return []

  const url = `${BASE}/search.json?q=${encodeURIComponent(q)}&limit=${limit}&fields=${SEARCH_FIELDS}`
  const data = await getJson<{ docs?: unknown }>(url)
  if (data === null) return null
  const docs = responseDocs(data)
  if (docs === null) return null

  return docs.map(toOlBook).filter((b): b is OlBook => b !== null)
}

interface WorkResponse {
  description?: string | { value?: string }
  subjects?: string[]
}

export type OlWorkResult =
  { kind: 'ok'; work: OlWorkDetail } | { kind: 'missing' } | { kind: 'unavailable' }

// The only reliable way to resolve an OLID: `q=` does not match work ids.
export async function fetchWork(olid: string): Promise<OlWorkResult> {
  const result = await requestJson<WorkResponse>(`${BASE}/works/${encodeURIComponent(olid)}.json`)
  if (result.kind !== 'ok') return result
  const data = result.value

  const description =
    typeof data.description === 'string' ? data.description : (data.description?.value ?? null)

  return {
    kind: 'ok',
    work: {
      description,
      subjects: [...(data.subjects ?? [])],
      raw: data
    }
  }
}

// Via search rather than /subjects/{slug}.json, which reports no language and
// accepts no language filter. `sort=editions` replaces its curated ordering.
export async function fetchSubject(subject: string, limit = 24): Promise<OlBook[]> {
  const s = subject.trim()
  if (!s) return []

  const q = `subject:"${s.replace(/"/g, '')}"`
  const url =
    `${BASE}/search.json?q=${encodeURIComponent(q)}&limit=${limit}` +
    `&sort=editions&fields=${SEARCH_FIELDS}`

  const data = await getJson<{ docs?: unknown }>(url)
  const docs = data ? responseDocs(data) : null

  return (docs ?? []).map(toOlBook).filter((b): b is OlBook => b !== null)
}

export async function fetchByAuthor(author: string, limit = 16): Promise<OlBook[]> {
  const a = author.trim()
  if (!a) return []

  const url = `${BASE}/search.json?author=${encodeURIComponent(a)}&limit=${limit}&fields=${SEARCH_FIELDS}`
  const data = await getJson<{ docs?: unknown }>(url)
  const docs = data ? responseDocs(data) : null

  return (docs ?? []).map(toOlBook).filter((b): b is OlBook => b !== null)
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
