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

function yearOf(value: string | string[] | undefined): number | null {
  const values = Array.isArray(value) ? value : value ? [value] : []
  for (const item of values) {
    const match = item.match(/\b(1[0-9]{3}|20[0-9]{2})\b/)
    if (match) return Number(match[1])
  }
  return null
}

// Prefer the explicitly requested edition language. Search calls filter to
// that language at the API, while this chooses the matching edition returned
// inside the work. Once selected, its title, jacket and ISBN stay together.
function display(doc: SearchDoc, languages: readonly string[]): Display {
  const work = {
    title: (doc.title ?? '').trim(),
    coverId: doc.cover_i ?? null,
    isbn: null,
    editionOlid: null,
    pageCount: doc.number_of_pages_median ?? null,
    publishedYear: doc.first_publish_year ?? null,
    languages: [...(doc.language ?? [])]
  }

  const readable = new Set(languages.map((language) => language.toLowerCase()))
  const editions = doc.editions?.docs ?? []
  const edition =
    editions.find((candidate) =>
      candidate.language?.some((language) => readable.has(language.toLowerCase()))
    ) ?? editions[0]
  if (!edition) return work

  return {
    title: edition.title?.trim() || work.title,
    coverId: edition.cover_i ?? null,
    isbn: edition.isbn?.[0] ?? null,
    editionOlid: toEditionOlid(edition.key),
    pageCount: edition.number_of_pages ?? null,
    publishedYear: yearOf(edition.publish_date),
    languages: [...(edition.language ?? [])]
  }
}

function displayAuthor(doc: SearchDoc): string | null {
  const names = (doc.author_name ?? []).map((name) => name.trim()).filter(Boolean)
  if (names.length === 0) return null
  return latinAuthorName(names[0], doc.author_alternative_name ?? [], names.slice(1))
}

export function toOlBook(
  doc: SearchDoc,
  languages: readonly string[] = READING_LANGUAGES
): OlBook | null {
  const olid = toOlid(doc.key)
  if (!olid || !doc.title) return null

  const shown = display(doc, languages)

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

// `language=eng` is the catalogue filter; `lang=en` asks Open Library to pick
// the English edition inside each matching work. The app currently supplies
// only `eng`, but keeping the conversion here avoids mixing both code systems.
function editionLanguage(codes: readonly string[]): string {
  const catalogueCode = codes[0]?.toLowerCase()
  if (!catalogueCode) return ''

  const displayCode = catalogueCode === 'eng' ? 'en' : catalogueCode
  return `&language=${encodeURIComponent(catalogueCode)}&lang=${encodeURIComponent(displayCode)}`
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
  'editions.number_of_pages',
  'editions.publish_date'
].join(',')

function identityPart(value: string | null): string {
  return (value ?? '')
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

function personIdentity(value: string | null): string {
  return identityPart(value).split(' ').filter(Boolean).sort().join(' ')
}

// Search should show one title/author pair, but the first one stays first:
// Open Library's relevance order is authoritative.
function firstDuplicateOnly(items: OlBook[]): OlBook[] {
  const result: OlBook[] = []
  const seen = new Set<string>()

  for (const item of items) {
    const key = `${identityPart(item.title)}\u0000${identityPart(item.author)}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(item)
  }

  return result
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

  const url =
    `${BASE}/search.json?q=${encodeURIComponent(q)}&limit=${limit}&fields=${SEARCH_FIELDS}` +
    editionLanguage(languages)
  const data = await getJson<{ docs?: SearchDoc[] }>(url)
  if (data === null) return null

  return firstDuplicateOnly(
    (data.docs ?? []).map((doc) => toOlBook(doc, languages)).filter((b): b is OlBook => b !== null)
  )
}

function searchPhrase(value: string): string {
  return value.replace(/["\\]/g, ' ').replace(/\s+/g, ' ').trim()
}

export async function searchBookByTitleAuthor(
  title: string,
  author: string | null,
  limit = 12,
  languages: readonly string[] = READING_LANGUAGES
): Promise<OlBook[] | null> {
  const cleanTitle = searchPhrase(title)
  if (!cleanTitle) return []
  const cleanAuthor = searchPhrase(author ?? '')
  const query = cleanAuthor
    ? `title:"${cleanTitle}" author:"${cleanAuthor}"`
    : `title:"${cleanTitle}"`
  const exact = await searchBooks(query, limit, languages)
  if (exact === null || exact.length > 0 || !cleanAuthor) return exact

  // Open Library's author phrase parser treats punctuation and spacing as
  // significant: "J. R. R. Tolkien" can miss a record filed as
  // "J.R.R. Tolkien". Retry by title, then keep only the same normalized
  // author so the fallback cannot turn a book into a different author's work.
  const byTitle = await searchBooks(`title:"${cleanTitle}"`, Math.max(limit, 12), languages)
  if (byTitle === null) return null

  const wantedAuthor = personIdentity(author)
  return byTitle.filter((book) => personIdentity(book.author) === wantedAuthor).slice(0, limit)
}

// A saved book is already identified. Querying the Search API by its exact
// work key lets Open Library select the current English edition without
// re-identifying the book from mutable title and author text.
export function searchWorkByOlid(
  olid: string,
  languages: readonly string[] = READING_LANGUAGES
): Promise<OlBook[] | null> {
  const id = olid.trim().toUpperCase()
  if (!/^OL\d+W$/.test(id)) return Promise.resolve([])
  return searchBooks(`key:/works/${id}`, 1, languages)
}

// A raw, fielded Search API query for Discover. Unlike the older one-subject
// harvest this keeps Open Library's relevance order and preserves `null`, so a
// partial outage cannot replace a healthy cached pool with an incomplete one.
export async function fetchCandidates(
  query: string,
  limit = 50,
  languages: readonly string[] = READING_LANGUAGES
): Promise<OlBook[] | null> {
  const q = query.trim()
  if (!q) return []

  const url =
    `${BASE}/search.json?q=${encodeURIComponent(q)}&limit=${limit}&fields=${SEARCH_FIELDS}` +
    editionLanguage(languages)
  const data = await getJson<{ docs?: SearchDoc[] }>(url)
  if (data === null) return null

  return (data.docs ?? [])
    .map((doc) => toOlBook(doc, languages))
    .filter((b): b is OlBook => b !== null)
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
    subjects: [...(data.subjects ?? [])],
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

  const q = `subject:"${s.replace(/"/g, '')}"`
  const url =
    `${BASE}/search.json?q=${encodeURIComponent(q)}&limit=${limit}` +
    `&sort=editions&fields=${SEARCH_FIELDS}${editionLanguage(languages)}`

  const data = await getJson<{ docs?: SearchDoc[] }>(url)

  return (data?.docs ?? [])
    .map((doc) => toOlBook(doc, languages))
    .filter((b): b is OlBook => b !== null)
}

export async function fetchByAuthor(
  author: string,
  limit = 16,
  languages: readonly string[] = READING_LANGUAGES
): Promise<OlBook[]> {
  const a = author.trim()
  if (!a) return []

  const url =
    `${BASE}/search.json?author=${encodeURIComponent(a)}&limit=${limit}&fields=${SEARCH_FIELDS}` +
    editionLanguage(languages)
  const data = await getJson<{ docs?: SearchDoc[] }>(url)

  return (data?.docs ?? [])
    .map((doc) => toOlBook(doc, languages))
    .filter((b): b is OlBook => b !== null)
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
