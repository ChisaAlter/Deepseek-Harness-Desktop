/** Decision produced while tracking movement during a long-press gesture */
export type LongPressMoveDecision =
  | "none"
  | "cancel_long_press"
  | "vertical_scroll"
  | "horizontal_swipe"
  | "start_drag";

/**
 * Arbitrates between scroll, swipe, drag, and long-press cancel from pointer movement
 * @param input Drag arming state, start/current points, and optional slop thresholds
 * @returns Gesture decision for the current movement sample
 */
export function decideLongPressMove(input: {
  dragArmed: boolean;
  didStartDrag: boolean;
  startPoint: { x: number; y: number } | null;
  currentPoint: { x: number; y: number };
  cancelSlopPx?: number;
  scrollSlopPx?: number;
  swipeSlopPx?: number;
  directionalDominanceRatio?: number;
  dragSlopPx?: number;
}): LongPressMoveDecision {
  const cancelSlopPx = input.cancelSlopPx ?? 10;
  const scrollSlopPx = input.scrollSlopPx ?? 6;
  const swipeSlopPx = input.swipeSlopPx ?? 8;
  const directionalDominanceRatio = input.directionalDominanceRatio ?? 1.5;
  const dragSlopPx = input.dragSlopPx ?? 8;

  if (!input.startPoint) {
    return "none";
  }
  if (input.didStartDrag) {
    return "none";
  }

  const dx = input.currentPoint.x - input.startPoint.x;
  const dy = input.currentPoint.y - input.startPoint.y;
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);
  const distance = Math.sqrt(dx * dx + dy * dy);
  const clearlyVertical = absDy >= absDx * directionalDominanceRatio;
  const clearlyHorizontal = absDx >= absDy * directionalDominanceRatio;

  if (!input.dragArmed) {
    if (clearlyVertical && absDy > scrollSlopPx) {
      return "vertical_scroll";
    }
    if (clearlyHorizontal && absDx > swipeSlopPx) {
      return "horizontal_swipe";
    }
    return distance > cancelSlopPx ? "cancel_long_press" : "none";
  }
  return distance > dragSlopPx ? "start_drag" : "none";
}

/**
 * Whether releasing a long-press should open the context menu
 * @param input Whether long-press is armed and whether a drag already started
 * @returns True when the press-out should open the context menu
 */
export function shouldOpenContextMenuOnPressOut(input: {
  longPressArmed: boolean;
  didStartDrag: boolean;
}): boolean {
  return input.longPressArmed && !input.didStartDrag;
}
