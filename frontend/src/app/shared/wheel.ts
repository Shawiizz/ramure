/** A wheel's line, in px, when it counts in lines. */
const LINE = 32;
/** Deltas this small come from a touchpad, which already scrolls smoothly. */
const TOUCHPAD = 50;
/** Each frame covers this share of the way left: quick, and smooth at the end. */
const EASE = 0.3;

/**
 * Wheel scrolling of `view` at `speed` times the system's distance, eased over a few
 * frames; a touchpad's small steps go through as they come. Shift and Ctrl wheels are left
 * to the browser. Returns what stops it.
 */
export function speedUpWheel(view: HTMLElement, speed: () => number): () => void {
  let target = view.scrollTop;
  let frame = 0;
  const max = () => view.scrollHeight - view.clientHeight;
  const step = () => {
    const left = target - view.scrollTop;
    if (Math.abs(left) < 0.5) {
      view.scrollTop = target;
      frame = 0;
      return;
    }
    view.scrollTop += left * EASE;
    frame = requestAnimationFrame(step);
  };
  const wheel = (event: WheelEvent) => {
    if (event.shiftKey || event.ctrlKey || !event.deltaY) return;
    event.preventDefault();
    const delta = event.deltaY * (event.deltaMode === WheelEvent.DOM_DELTA_LINE ? LINE : 1);
    // scrolled meanwhile by other means (the scroll bar, a commit brought into view)
    if (!frame) target = view.scrollTop;
    target = Math.min(max(), Math.max(0, target + delta * speed()));
    if (Math.abs(delta) < TOUCHPAD) {
      cancelAnimationFrame(frame);
      frame = 0;
      view.scrollTop = target;
    } else if (!frame) {
      frame = requestAnimationFrame(step);
    }
  };
  view.addEventListener('wheel', wheel, { passive: false });
  return () => {
    cancelAnimationFrame(frame);
    view.removeEventListener('wheel', wheel);
  };
}
