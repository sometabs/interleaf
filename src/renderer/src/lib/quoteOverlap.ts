export type Overlap = 'apart' | 'inside' | 'overlap'

// Negative when point a comes before point b in the document.
function order(aNode: Node, aOffset: number, bNode: Node, bOffset: number): number {
  const at = aNode.ownerDocument!.createRange()
  at.setStart(aNode, aOffset)
  at.collapse(true)
  return -at.comparePoint(bNode, bOffset)
}

// How a new selection relates to an existing quote. Touching end to end counts as apart.
export function overlapOf(selection: Range, quote: Range): Overlap {
  if (
    order(selection.endContainer, selection.endOffset, quote.startContainer, quote.startOffset) <=
      0 ||
    order(selection.startContainer, selection.startOffset, quote.endContainer, quote.endOffset) >= 0
  ) {
    return 'apart'
  }
  const startsInside =
    order(
      quote.startContainer,
      quote.startOffset,
      selection.startContainer,
      selection.startOffset
    ) <= 0
  const endsInside =
    order(selection.endContainer, selection.endOffset, quote.endContainer, quote.endOffset) <= 0
  return startsInside && endsInside ? 'inside' : 'overlap'
}

// The smallest range covering all of them, for a quote that grows over its neighbours.
export function unionOf(ranges: Range[]): Range {
  const union = ranges[0].cloneRange()
  for (const range of ranges.slice(1)) {
    if (
      order(range.startContainer, range.startOffset, union.startContainer, union.startOffset) < 0
    ) {
      union.setStart(range.startContainer, range.startOffset)
    }
    if (order(range.endContainer, range.endOffset, union.endContainer, union.endOffset) > 0) {
      union.setEnd(range.endContainer, range.endOffset)
    }
  }
  return union
}
