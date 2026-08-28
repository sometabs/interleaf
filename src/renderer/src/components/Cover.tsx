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

  const rounding = size === 'sm' ? 'rounded-[5px]' : 'rounded-lg'
  const shadow = size === 'lg' ? 'shadow-raised' : 'shadow-card'

  return (
    <div
      data-testid="cover"
      className={`relative aspect-[2/3] w-full overflow-hidden bg-sunken ${rounding} ${shadow}`}
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
        /*
          A placeholder rather than a poster: the title and the author on the
          flat surface colour, which is all there is to say until a real cover
          arrives. Initials over a gradient were the busiest thing in the grid
          and told nobody anything: "TD" is not a book.
        */
        <div
          aria-hidden="true"
          className="flex h-full w-full flex-col justify-center gap-[3%] border border-hairline bg-surface p-[10%]"
        >
          {size !== 'sm' && (
            <>
              <span
                className="line-clamp-3 font-semibold leading-tight text-ink"
                style={{ fontSize: 'clamp(9px, 11cqw, 15px)' }}
              >
                {title}
              </span>
              {author && (
                <span
                  className="truncate text-ink-muted"
                  style={{ fontSize: 'clamp(7px, 8cqw, 11px)' }}
                >
                  {author}
                </span>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
