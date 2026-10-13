/**
 * Follows the pointer from `event` (a press on a handle) until it is let go, telling
 * `moved` how far it went from where it was pressed.
 */
export function follow(event: PointerEvent, moved: (dx: number, dy: number) => void) {
  const handle = event.currentTarget as HTMLElement;
  const x = event.clientX;
  const y = event.clientY;
  event.preventDefault();
  handle.setPointerCapture(event.pointerId);
  const move = (e: PointerEvent) => moved(e.clientX - x, e.clientY - y);
  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', () => handle.removeEventListener('pointermove', move), {
    once: true,
  });
}
