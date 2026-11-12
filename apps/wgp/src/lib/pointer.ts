/**
 * Pointer capture that can't throw. `setPointerCapture` raises (NotFoundError, or
 * InvalidStateError while a pointer lock is being taken) when the pointer isn't an active
 * one: a synthetic event from a script or an assistive tool, or a touch the system already
 * took back. Capture only keeps a drag's events coming after the pointer leaves the
 * element, so going without it is safe; an uncaught error in a pointerdown handler is not.
 */
export function capturePointer(target: Element, pointerId: number): boolean {
  try {
    target.setPointerCapture(pointerId);
    return true;
  } catch {
    return false;
  }
}
