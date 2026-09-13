import { readFileSync } from 'fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// "Nothing found" is a claim about the catalogue, which a request that never
// completed is not entitled to make.

// A fresh module per test: the throttle keeps its clock in module scope.
async function loadSearch(): Promise<
  typeof import('../src/main/services/openlibrary').searchBooks
> {
  vi.resetModules()
  return (await import('../src/main/services/openlibrary')).searchBooks
}

function respondWith(body: unknown, status = 200): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        ({
          ok: status >= 200 && status < 300,
          status,
          headers: new Headers(),
          json: async () => body
        }) as unknown as Response
    )
  )
}

beforeEach(() => {
  calls = 0
})

afterEach(() => {
  vi.unstubAllGlobals()
})

let calls = 0

describe('a search that did not happen', () => {
  it('is null when the request times out, not an empty result', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls++
        throw Object.assign(new Error('The operation was aborted due to timeout'), {
          name: 'TimeoutError'
        })
      })
    )
    const searchBooks = await loadSearch()

    expect(await searchBooks('the dispossessed')).toBeNull()
    expect(calls).toBe(1)
  })

  it('is null when the request fails outright', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed')
      })
    )
    const searchBooks = await loadSearch()

    expect(await searchBooks('the dispossessed')).toBeNull()
  })

  it('is null on a server error', async () => {
    respondWith('Internal Server Error', 500)
    const searchBooks = await loadSearch()

    expect(await searchBooks('the dispossessed')).toBeNull()
  })
})

// `fetch` reports every network problem as a bare "fetch failed" and hangs the
// real reason off `cause`.
describe('what the log says when a request fails', () => {
  it('reports the underlying cause, not just "fetch failed"', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw Object.assign(new TypeError('fetch failed'), {
          cause: Object.assign(new Error('Connect Timeout Error'), {
            code: 'UND_ERR_CONNECT_TIMEOUT'
          })
        })
      })
    )
    const searchBooks = await loadSearch()

    expect(await searchBooks('harry potter')).toBeNull()

    const logged = warn.mock.calls.map((call) => String(call[0])).join('\n')
    expect(logged).toContain('UND_ERR_CONNECT_TIMEOUT')
    // And which request it was, so a harvest can be told from a search.
    expect(logged).toContain('openlibrary.org/search.json')
    warn.mockRestore()
  })

  it('reports the status when Open Library answers badly', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    respondWith('Internal Server Error', 500)
    const searchBooks = await loadSearch()

    expect(await searchBooks('harry potter')).toBeNull()
    expect(warn.mock.calls.map((call) => String(call[0])).join('\n')).toContain('500')
    warn.mockRestore()
  })
})

describe('a search that did happen', () => {
  it('is an empty array when Open Library genuinely has nothing', async () => {
    respondWith({ numFound: 0, docs: [] })
    const searchBooks = await loadSearch()

    expect(await searchBooks('qwertyuiop not a book')).toEqual([])
  })

  it('is the parsed results when it has something', async () => {
    respondWith({ docs: [{ key: '/works/OL27448W', title: 'The Dispossessed' }] })
    const searchBooks = await loadSearch()

    const found = await searchBooks('the dispossessed')
    expect(found).toHaveLength(1)
    expect(found?.[0]).toMatchObject({ olid: 'OL27448W', title: 'The Dispossessed' })
  })

  it('collapses duplicate title/author results without changing API order', async () => {
    respondWith({
      docs: [
        {
          key: '/works/OL38060433W',
          title: 'Being and Nothingness',
          author_name: ['Jean-Paul Sartre'],
          editions: {
            docs: [
              {
                key: '/books/OL55213692M',
                title: 'Being and Nothingness',
                language: ['eng']
              }
            ]
          }
        },
        {
          key: '/works/OL1161325W',
          title: "L'être et le néant",
          author_name: ['Jean-Paul Sartre'],
          subject: ['Existentialism', 'Ontology', 'Philosophy'],
          editions: {
            docs: [
              {
                key: '/books/OL51699762M',
                title: 'Being and Nothingness',
                cover_i: 14882069,
                language: ['eng']
              }
            ]
          }
        }
      ]
    })
    const searchBooks = await loadSearch()

    const found = await searchBooks('Being and Nothingness')
    expect(found).toHaveLength(1)
    expect(found?.[0]).toMatchObject({
      olid: 'OL38060433W',
      editionOlid: 'OL55213692M',
      title: 'Being and Nothingness',
      coverId: null,
      subjects: []
    })
  })

  it('is an empty array for a blank query, which never reaches the network', async () => {
    respondWith({ docs: [] })
    const searchBooks = await loadSearch()

    expect(await searchBooks('   ')).toEqual([])
  })
})

it('allows Open Library long enough to answer a slow search', () => {
  const source = readFileSync('src/main/services/openlibrary.ts', 'utf8')
  const timeout = Number(/const TIMEOUT_MS = (\d+)/.exec(source)?.[1])

  expect(timeout).toBeGreaterThanOrEqual(20000)
})
