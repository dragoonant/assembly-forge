// Tap versus drag on the board. The camera controller (mapController.ts) sets `dragged` as soon as a press moves 8 px or a second finger lands;
// every board click handler asks `isTap()` first, so a pan, pinch or twist never also selects or acts (card-games §5: distance, never time).
export const gesture = { dragged: false }

/** True when the click that is being handled ended a tap, not a camera gesture. */
export function isTap(): boolean {
  return !gesture.dragged
}
