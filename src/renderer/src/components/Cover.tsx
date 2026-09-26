import { useState, type ReactNode } from 'react'

interface Props {
  title: string
  author?: string | null
  /** Cached cover filename, served through the bookcover: protocol. */
  path?: string | null
  /** Open Library cover id, for books not yet in the library. */
  coverId?: number | null
  size?: 'sm' | 'md' | 'lg'
}

interface PlaceholderPalette {
  cover: string
  spine: string
  ink: string
  detail: string
}

// Muted clothbound colours: varied enough to distinguish neighbouring books,
// restrained enough that a placeholder never masquerades as real cover art.
const PLACEHOLDER_PALETTES: readonly PlaceholderPalette[] = [
  { cover: '#3f5268', spine: '#2d3d50', ink: '#f7f4ec', detail: '#9daaba' },
  { cover: '#7a4650', spine: '#5e3039', ink: '#fff7ed', detail: '#cba0a6' },
  { cover: '#657560', spine: '#4b5b47', ink: '#fbf8eb', detail: '#aeb8a8' },
  { cover: '#936b38', spine: '#714d25', ink: '#fff8e8', detail: '#d1b786' },
  { cover: '#416969', spine: '#2d5050', ink: '#f4fbf8', detail: '#91b2af' },
  { cover: '#66536f', spine: '#4d3c57', ink: '#fbf5ff', detail: '#ad9ab5' }
]

function paletteFor(title: string): PlaceholderPalette {
  let hash = 2166136261
  for (const char of title.normalize('NFKC').toLowerCase()) {
    hash ^= char.codePointAt(0) ?? 0
    hash = Math.imul(hash, 16777619)
  }
  return PLACEHOLDER_PALETTES[(hash >>> 0) % PLACEHOLDER_PALETTES.length]
}

function initialFor(title: string): string {
  return (
    title
      .trim()
      .match(/[\p{L}\p{N}]/u)?.[0]
      ?.toLocaleUpperCase() ?? '•'
  )
}

export default function Cover({
  title,
  author = null,
  path = null,
  coverId = null,
  size = 'md'
}: Props): ReactNode {
  // Never a remote image: covers.openlibrary.org redirects to archive.org, and
  // Chromium enforces `img-src` against the redirect target.
  const src = path
    ? `bookcover://covers/${encodeURIComponent(path)}`
    : coverId
      ? `bookcover://id/${coverId}`
      : null

  // Which src failed, not a bare boolean: `failed = true` never resets, so one
  // transient error would pin the placeholder even once `src` works.
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const failed = src !== null && failedSrc === src

  const shadow = size === 'lg' ? 'shadow-raised' : 'shadow-card'
  const palette = paletteFor(title)

  return (
    <div
      data-testid="cover"
      className={`relative aspect-[2/3] w-full overflow-hidden rounded-control bg-sunken ${shadow}`}
      style={{ containerType: 'inline-size' }}
    >
      {src && !failed ? (
        // No loading="lazy": inside a container-query box Chromium can defer
        // the load indefinitely and never paint.
        <img
          src={src}
          alt=""
          className="block h-full w-full object-cover"
          onError={() => setFailedSrc(src)}
        />
      ) : (
        /* A quiet clothbound stand-in. It is deliberately typographic rather
           than illustrated, so nobody mistakes it for a real jacket. */
        <div
          aria-hidden="true"
          className="relative h-full w-full select-none overflow-hidden border border-black/10"
          style={{
            color: palette.ink,
            backgroundColor: palette.cover,
            backgroundImage:
              'repeating-linear-gradient(90deg, rgb(255 255 255 / 0.025) 0 1px, transparent 1px 3px), repeating-linear-gradient(0deg, rgb(0 0 0 / 0.018) 0 1px, transparent 1px 4px)'
          }}
        >
          <div
            className="absolute inset-y-0 left-0 w-[8%] border-r border-black/15"
            style={{ backgroundColor: palette.spine }}
          />
          <div
            className="absolute bottom-[6%] left-[13%] right-[6%] top-[6%] border"
            style={{ borderColor: palette.detail }}
          />

          {size === 'sm' ? (
            <div
              className="relative ml-[8%] flex h-full items-center justify-center font-semibold"
              style={{
                fontFamily: 'var(--font-read)',
                fontSize: 'clamp(12px, 34cqw, 24px)'
              }}
            >
              {initialFor(title)}
            </div>
          ) : (
            <div className="relative ml-[8%] flex h-full flex-col items-center justify-center px-[12%] py-[14%] text-center">
              <span
                className="line-clamp-4 font-semibold leading-tight"
                style={{
                  fontFamily: 'var(--font-read)',
                  fontSize: 'clamp(10px, 11cqw, 17px)'
                }}
              >
                {title}
              </span>
              {author && (
                <>
                  <span
                    className="my-[8%] block h-px w-[34%]"
                    style={{ backgroundColor: palette.detail }}
                  />
                  <span
                    className="line-clamp-2 leading-tight opacity-85"
                    style={{ fontSize: 'clamp(7px, 7.5cqw, 11px)' }}
                  >
                    {author}
                  </span>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
