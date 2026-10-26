// Maps each item to its position in the base order
export function basePositions(items, baseOrder) {
  const kept = items
    .map((item) => item.id)
    .filter((id) => baseOrder.includes(id))
    .sort((x, y) => baseOrder.indexOf(x) - baseOrder.indexOf(y));

  return new Map(kept.map((id, index) => [id, index]));
}

