export interface Placement {
  left: number
  top: number
  below: boolean
}

const EDGE = 8
// The gap under the passage, so a popup below does not cover the line it is about.
const UNDER = 28
// A passage this close to the top always opens its popup below.
const NEAR_TOP = 64

// Above the point when it fits, else on the side with more room; never past the area's sides,
// where a passage near the right edge used to push half its popup out of the window.
export function placePopover(
  point: { x: number; y: number },
  size: { width: number; height: number },
  area: { width: number; height: number }
): Placement {
  const roomAbove = point.y - EDGE - EDGE
  const roomBelow = area.height - (point.y + UNDER) - EDGE
  const below = point.y < NEAR_TOP || (size.height > roomAbove && roomBelow > roomAbove)
  const half = size.width / 2
  const left = Math.max(half + EDGE, Math.min(point.x, area.width - half - EDGE))
  return { left, top: below ? point.y + UNDER : point.y - EDGE, below }
}
