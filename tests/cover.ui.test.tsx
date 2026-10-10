import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import Cover from '../src/renderer/src/components/Cover'

describe('generated cover text', () => {
  it.each(['md', 'lg'] as const)('wraps unbroken text within a %s cover', (size) => {
    const title = 'AnExtremelyLongUnbrokenBookTitle'.repeat(8)
    const author = 'AnExtremelyLongUnbrokenAuthorName'.repeat(8)
    render(<Cover title={title} author={author} size={size} />)

    for (const [text, clamp] of [
      [title, 'line-clamp-4'],
      [author, 'line-clamp-2']
    ]) {
      const element = screen.getByText(text)
      expect(element.textContent).toBe(text)
      for (const className of ['min-w-0', 'w-full', 'wrap-anywhere', clamp]) {
        expect(element.classList.contains(className)).toBe(true)
      }
    }
  })

  it('also constrains placeholder text after a real cover fails to load', () => {
    render(<Cover title="A Long Title" author="An Author" coverId={123} />)
    fireEvent.error(screen.getByTestId('cover').querySelector('img')!)

    expect(screen.getByText('A Long Title').classList.contains('wrap-anywhere')).toBe(true)
    expect(screen.getByText('An Author').classList.contains('wrap-anywhere')).toBe(true)
  })

  it('keeps the compact cover as an initial', () => {
    render(<Cover title="AnExtremelyLongUnbrokenBookTitle" author="An Author" size="sm" />)

    expect(screen.getByText('A')).toBeDefined()
    expect(screen.queryByText('An Author')).toBeNull()
  })
})
