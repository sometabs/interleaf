export function sameOrder(left: number[], right: number[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index])
}

export function insertAround(
  ids: number[],
  draggedBookId: number,
  targetBookId: number,
  afterTarget: boolean
): number[] {
  if (draggedBookId === targetBookId) return ids

  const next = ids.filter((id) => id !== draggedBookId)
  const targetIndex = next.indexOf(targetBookId)
  if (targetIndex < 0) return ids
  next.splice(targetIndex + (afterTarget ? 1 : 0), 0, draggedBookId)
  return next
}
