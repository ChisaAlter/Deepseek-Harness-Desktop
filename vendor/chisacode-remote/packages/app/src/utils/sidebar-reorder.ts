/**
 * Merges a reordered visible key list with the remainder of the current order
 * @param input Full current order and the reordered subset of visible keys
 * @returns New order with reordered keys first, followed by keys not in the visible set
 */
export function mergeWithRemainder(input: {
  currentOrder: string[];
  reorderedVisibleKeys: string[];
}): string[] {
  const reorderedSet = new Set(input.reorderedVisibleKeys);
  const remainder = input.currentOrder.filter((key) => !reorderedSet.has(key));
  return [...input.reorderedVisibleKeys, ...remainder];
}

/**
 * Whether the relative order of currently visible keys changed after a reorder
 * @param input Full current order and the proposed reordered visible keys
 * @returns True when the visible subset order differs from the current order
 */
export function hasVisibleOrderChanged(input: {
  currentOrder: string[];
  reorderedVisibleKeys: string[];
}): boolean {
  const visibleSet = new Set(input.reorderedVisibleKeys);
  const currentVisible = input.currentOrder.filter((key) => visibleSet.has(key));
  if (currentVisible.length !== input.reorderedVisibleKeys.length) {
    return true;
  }
  return input.reorderedVisibleKeys.some((key, index) => currentVisible[index] !== key);
}
