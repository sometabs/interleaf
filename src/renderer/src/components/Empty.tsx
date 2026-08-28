import type { ReactNode } from 'react'

interface Props {
  title?: string
  children?: ReactNode
  action?: ReactNode
}

/** The one empty state in the app, so they all read and sit the same. */
export default function Empty({ title, children, action }: Props): ReactNode {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-8 py-16 text-center">
      {title && <h2 className="text-[17px] text-ink">{title}</h2>}
      {children && <p className="max-w-sm text-[14px] text-ink-muted">{children}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
