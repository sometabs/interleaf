import type { RecommendationNode } from '@shared/api'
import { act, fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import RecommendationTree from '../src/renderer/src/components/RecommendationTree'
import { installBridge, renderApp } from './helpers/render'

function node(
  olid: string,
  score: number,
  depth: number,
  children: RecommendationNode[] = [],
  similarityToParent: number | null = null
): RecommendationNode {
  return {
    olid,
    title: `Book ${olid}`,
    author: 'Someone',
    coverId: null,
    score,
    becauseOf: { bookId: 1, title: 'The Dispossessed' },
    subjects: ['Science fiction'],
    similarityToParent,
    depth,
    children
  }
}

const tree = [
  node('root', 0.9, 0, [
    node('child-a', 0.7, 1, [node('grandchild', 0.4, 2, [], 0.55)], 0.8),
    node('child-b', 0.6, 1, [], 0.6)
  ])
]

describe('RecommendationTree', () => {
  it('renders every node in the tree', () => {
    installBridge()
    renderApp(
      <RecommendationTree roots={tree} onSave={() => {}} onDismiss={() => {}} savingOlid={null} />
    )

    expect(screen.getAllByTestId('tree-node')).toHaveLength(4)
  })

  it('nests deeper nodes inside their parent', () => {
    installBridge()
    renderApp(
      <RecommendationTree roots={tree} onSave={() => {}} onDismiss={() => {}} savingOlid={null} />
    )

    const nodes = screen.getAllByTestId('tree-node')
    const root = nodes.find((n) => n.textContent?.includes('Book root'))!
    const grandchild = nodes.find((n) => n.textContent?.includes('Book grandchild'))!

    expect(root.parentElement?.contains(grandchild)).toBe(true)
    expect(grandchild.dataset.depth).toBe('2')
  })

  it('draws one edge per node below a root', () => {
    installBridge()
    renderApp(
      <RecommendationTree roots={tree} onSave={() => {}} onDismiss={() => {}} savingOlid={null} />
    )

    expect(screen.getAllByTestId('tree-edge')).toHaveLength(3)
  })

  it('labels the first root as the closest match', () => {
    installBridge()
    renderApp(
      <RecommendationTree roots={tree} onSave={() => {}} onDismiss={() => {}} savingOlid={null} />
    )

    expect(screen.getByText('Closest to your taste')).toBeDefined()
  })

  it('weights each edge with the resemblance to the node above', () => {
    installBridge()
    renderApp(
      <RecommendationTree roots={tree} onSave={() => {}} onDismiss={() => {}} savingOlid={null} />
    )

    const weights = screen.getAllByTestId('tree-edge').map((edge) => edge.textContent)
    expect(weights).toEqual(expect.arrayContaining(['80%', '60%', '55%']))
  })

  it('never claims a root grew from one book, because it did not', () => {
    // A root is ranked against the whole profile, not one book.
    installBridge()
    renderApp(
      <RecommendationTree roots={tree} onSave={() => {}} onDismiss={() => {}} savingOlid={null} />
    )

    expect(screen.queryByText(/Grown from/)).toBeNull()
    expect(screen.queryByText(/The Dispossessed/)).toBeNull()
    expect(screen.getByText('Closest to your taste')).toBeDefined()
  })

  it('acts on the node whose button was pressed', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    installBridge()
    renderApp(
      <RecommendationTree roots={tree} onSave={onSave} onDismiss={() => {}} savingOlid={null} />
    )

    await user.click(screen.getByLabelText('Want to read Book grandchild'))

    expect(onSave).toHaveBeenCalledWith('grandchild')
  })

  it('says so when there is nothing to arrange', () => {
    installBridge()
    renderApp(
      <RecommendationTree roots={[]} onSave={() => {}} onDismiss={() => {}} savingOlid={null} />
    )

    expect(screen.getByText('Nothing to arrange yet')).toBeDefined()
  })
})

function scaleOf(): string {
  const transform = screen.getByTestId('tree-stage').style.transform
  const match = /scale\(([^)]+)\)/.exec(transform)
  if (!match) throw new Error(`No scale in transform: "${transform}"`)
  return match[1]
}

describe('Zooming the tree', () => {
  function open(): void {
    installBridge()
    renderApp(
      <RecommendationTree roots={tree} onSave={() => {}} onDismiss={() => {}} savingOlid={null} />
    )
  }

  it('starts at life size', () => {
    open()
    expect(screen.getByLabelText('Reset zoom').textContent).toBe('100%')
    expect(scaleOf()).toBe('1')
  })

  it('scales the whole tree at once, so the connectors keep up', async () => {
    const user = userEvent.setup()
    open()

    await user.click(screen.getByLabelText('Zoom in'))

    // One transform on one element, so nothing can drift out of alignment.
    expect(scaleOf()).toBe('1.1')
    expect(screen.getByLabelText('Reset zoom').textContent).toBe('110%')
    expect(screen.getAllByTestId('tree-node')).toHaveLength(4)
  })

  it('zooms out as well as in', async () => {
    const user = userEvent.setup()
    open()

    await user.click(screen.getByLabelText('Zoom out'))
    await user.click(screen.getByLabelText('Zoom out'))

    expect(scaleOf()).toBe('0.8')
  })

  it('goes back to life size in one press', async () => {
    const user = userEvent.setup()
    open()

    await user.click(screen.getByLabelText('Zoom in'))
    await user.click(screen.getByLabelText('Zoom in'))
    await user.click(screen.getByLabelText('Reset zoom'))

    expect(scaleOf()).toBe('1')
  })

  it('refuses to shrink or grow past its limits', async () => {
    const user = userEvent.setup()
    open()

    for (let i = 0; i < 20; i++) await user.click(screen.getByLabelText('Zoom out'))
    expect(scaleOf()).toBe('0.5')
    expect((screen.getByLabelText('Zoom out') as HTMLButtonElement).disabled).toBe(true)

    for (let i = 0; i < 30; i++) await user.click(screen.getByLabelText('Zoom in'))
    expect(scaleOf()).toBe('1.6')
    expect((screen.getByLabelText('Zoom in') as HTMLButtonElement).disabled).toBe(true)
  })

  // Dispatched natively because the listener is non-passive, not a React one.
  function wheel(init: {
    deltaY?: number
    deltaX?: number
    ctrlKey?: boolean
    metaKey?: boolean
  }): Event {
    const event = new Event('wheel', { bubbles: true, cancelable: true })
    Object.assign(event, {
      deltaX: 0,
      deltaY: 0,
      deltaMode: 0,
      ctrlKey: false,
      metaKey: false,
      clientX: 400,
      ...init
    })
    act(() => {
      canvas().dispatchEvent(event)
    })
    return event
  }

  it('zooms in on ctrl+wheel up and out on ctrl+wheel down', () => {
    open()

    // One notch of an ordinary mouse is ~100px of delta.
    expect(wheel({ deltaY: -100, ctrlKey: true }).defaultPrevented).toBe(true)
    expect(scaleOf()).toBe('1.1')

    wheel({ deltaY: 200, ctrlKey: true })
    expect(scaleOf()).toBe('0.9')
  })

  // A bare wheel belongs to the scroller, or a tall tree cannot be scrolled.
  it('leaves a bare wheel to scroll the tree', () => {
    open()

    const event = wheel({ deltaY: -100 })

    expect(event.defaultPrevented).toBe(false)
    expect(scaleOf()).toBe('1')
  })

  it('scrolls on a bare wheel even where it could have zoomed', () => {
    open()
    for (let i = 0; i < 5; i++) wheel({ deltaY: 100 })

    expect(scaleOf()).toBe('1')
  })

  it('zooms on meta+wheel as well', () => {
    open()

    wheel({ deltaY: -100, metaKey: true })
    expect(scaleOf()).toBe('1.1')
  })

  it('swallows ctrl+wheel at the limit, where the window would zoom instead', () => {
    open()
    for (let i = 0; i < 10; i++) wheel({ deltaY: -100, ctrlKey: true })
    expect(scaleOf()).toBe('1.6')

    expect(wheel({ deltaY: -100, ctrlKey: true }).defaultPrevented).toBe(true)
    expect(scaleOf()).toBe('1.6')
  })

  it('keeps zooming away from a limit', () => {
    open()
    for (let i = 0; i < 10; i++) wheel({ deltaY: 100, ctrlKey: true })
    expect(scaleOf()).toBe('0.5')

    wheel({ deltaY: -100, ctrlKey: true })
    expect(scaleOf()).toBe('0.6')
  })

  it('leaves a sideways ctrl+wheel alone, but never lets the window have it', () => {
    open()

    // A full vertical notch, so only the larger sideways component blocks it.
    const event = wheel({ deltaX: -400, deltaY: -100, ctrlKey: true })

    expect(scaleOf()).toBe('1')
    expect(event.defaultPrevented).toBe(true)
  })

  it('reads a wheel that reports lines rather than pixels', () => {
    open()
    const event = new Event('wheel', { bubbles: true, cancelable: true })
    // deltaMode 1 is lines, so 3 means a notch rather than three pixels.
    Object.assign(event, { deltaX: 0, deltaY: -3, deltaMode: 1, ctrlKey: true, clientX: 400 })
    act(() => {
      canvas().dispatchEvent(event)
    })

    expect(scaleOf()).toBe('1.05')
  })

  // Inside the stage, not a margin: the scroll sizer is computed from
  // `offsetHeight`, which a margin is not part of.
  it('leaves room under the last row of nodes', () => {
    open()

    const stage = screen.getByTestId('tree-stage')
    expect(stage.style.paddingBottom).toBe('56px')
    expect(stage.style.marginBottom).toBe('')
  })
})

// jsdom does no layout, so `scrollLeft` is always 0 and writes are discarded.
function trackScroll(el: HTMLElement, axis: 'scrollLeft' | 'scrollTop' = 'scrollLeft'): void {
  let position = 0
  Object.defineProperty(el, axis, {
    configurable: true,
    get: () => position,
    set: (value: number) => {
      position = value
    }
  })
}

function canvas(): HTMLElement {
  return screen.getByTestId('tree-canvas')
}

describe('Dragging the tree around', () => {
  it('pulls the tree sideways, following the cursor', () => {
    installBridge()
    renderApp(
      <RecommendationTree roots={tree} onSave={() => {}} onDismiss={() => {}} savingOlid={null} />
    )
    trackScroll(canvas())

    fireEvent.pointerDown(canvas(), { pointerId: 1, button: 0, clientX: 300, clientY: 80 })
    fireEvent.pointerMove(canvas(), { pointerId: 1, clientX: 220, clientY: 80 })

    expect(canvas().scrollLeft).toBe(80)
  })

  it('pulls the tree up and down inside its own viewport', () => {
    installBridge()
    renderApp(
      <RecommendationTree roots={tree} onSave={() => {}} onDismiss={() => {}} savingOlid={null} />
    )
    trackScroll(canvas())
    trackScroll(canvas(), 'scrollTop')

    fireEvent.pointerDown(canvas(), { pointerId: 1, button: 0, clientX: 300, clientY: 400 })
    fireEvent.pointerMove(canvas(), { pointerId: 1, clientX: 300, clientY: 250 })

    // Both axes belong to the tree's scroller, or zooming shakes the page.
    expect(canvas().scrollTop).toBe(150)
    expect(canvas().scrollLeft).toBe(0)
  })

  it('ignores a tremor too small to be a drag', () => {
    installBridge()
    renderApp(
      <RecommendationTree roots={tree} onSave={() => {}} onDismiss={() => {}} savingOlid={null} />
    )
    trackScroll(canvas())

    fireEvent.pointerDown(canvas(), { pointerId: 1, button: 0, clientX: 300, clientY: 80 })
    fireEvent.pointerMove(canvas(), { pointerId: 1, clientX: 298, clientY: 82 })

    expect(canvas().scrollLeft).toBe(0)
    expect(canvas().dataset.dragging).toBeUndefined()
  })

  it('says when it is being dragged, and stops saying so on release', () => {
    installBridge()
    renderApp(
      <RecommendationTree roots={tree} onSave={() => {}} onDismiss={() => {}} savingOlid={null} />
    )
    trackScroll(canvas())

    fireEvent.pointerDown(canvas(), { pointerId: 1, button: 0, clientX: 300, clientY: 80 })
    fireEvent.pointerMove(canvas(), { pointerId: 1, clientX: 200, clientY: 80 })
    expect(canvas().dataset.dragging).toBe('true')

    fireEvent.pointerUp(canvas(), { pointerId: 1 })
    expect(canvas().dataset.dragging).toBeUndefined()
  })

  it('leaves a press on a button alone', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    installBridge()
    renderApp(
      <RecommendationTree roots={tree} onSave={onSave} onDismiss={() => {}} savingOlid={null} />
    )
    trackScroll(canvas())

    // The whole tree is draggable, so buttons inside it must still click.
    await user.click(screen.getByLabelText('Want to read Book root'))

    expect(onSave).toHaveBeenCalledWith('root')
    expect(canvas().scrollLeft).toBe(0)
  })

  it('drags by the same distance whatever the zoom', async () => {
    const user = userEvent.setup()
    installBridge()
    renderApp(
      <RecommendationTree roots={tree} onSave={() => {}} onDismiss={() => {}} savingOlid={null} />
    )
    trackScroll(canvas())

    // `scrollLeft` is in unscaled pixels, so 80px of pointer is always 80px.
    await user.click(screen.getByLabelText('Zoom in'))
    fireEvent.pointerDown(canvas(), { pointerId: 1, button: 0, clientX: 300, clientY: 80 })
    fireEvent.pointerMove(canvas(), { pointerId: 1, clientX: 220, clientY: 80 })

    expect(canvas().scrollLeft).toBe(80)
  })

  it('does not press a button the drag happened to finish on', () => {
    const onSave = vi.fn()
    installBridge()
    renderApp(
      <RecommendationTree roots={tree} onSave={onSave} onDismiss={() => {}} savingOlid={null} />
    )
    trackScroll(canvas())
    const button = screen.getByLabelText('Want to read Book root')

    fireEvent.pointerDown(canvas(), { pointerId: 1, button: 0, clientX: 300, clientY: 80 })
    fireEvent.pointerMove(canvas(), { pointerId: 1, clientX: 180, clientY: 80 })
    fireEvent.pointerUp(canvas(), { pointerId: 1 })
    fireEvent.click(button)

    expect(onSave).not.toHaveBeenCalled()

    fireEvent.click(button)
    expect(onSave).toHaveBeenCalledWith('root')
  })
})
