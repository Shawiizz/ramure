import { DestroyRef, Directive, ElementRef, afterNextRender, inject } from '@angular/core';

/** How long a bar stays in sight after the content last scrolled. */
const LINGER_MS = 900;
/** The smallest a thumb gets, however long the content. */
const MIN_THUMB = 24;
/** A bar's thickness, as the system's was. */
const SIZE = 10;

type Axis = 'x' | 'y';

/**
 * A scroll container's bars drawn over its content instead of beside it, so the content
 * keeps the whole width: a row's hover reaches the edge. They show under the pointer and
 * while scrolling; a thumb drags, a click on the track turns a page. The container's
 * parent holds them, made a positioned box if it was not one.
 */
@Directive({ selector: '[appOverlayScroll]', host: { class: 'r-overlay-scroll' } })
export class OverlayScroll {
  constructor() {
    const view = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const destroy = inject(DestroyRef);
    afterNextRender(() => {
      const parent = view.parentElement!;
      if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
      const bars = (['y', 'x'] as const).map((axis) => bar(view, parent, axis));
      let linger: ReturnType<typeof setTimeout> | undefined;
      const show = (shown: boolean) =>
        bars.forEach((b) => b.track.classList.toggle('shown', shown));
      const update = () => bars.forEach((b) => b.update());
      const scrolled = () => {
        update();
        show(true);
        clearTimeout(linger);
        linger = setTimeout(() => show(view.matches(':hover')), LINGER_MS);
      };
      const enter = () => (update(), show(true));
      const leave = () => show(false);
      view.addEventListener('scroll', scrolled, { passive: true });
      view.addEventListener('pointerenter', enter);
      view.addEventListener('pointerleave', leave);
      const resized = new ResizeObserver(update);
      resized.observe(view);
      // the content grows and shrinks as its lines come and go
      const changed = new MutationObserver(update);
      changed.observe(view, { childList: true, subtree: true });
      update();
      destroy.onDestroy(() => {
        clearTimeout(linger);
        view.removeEventListener('scroll', scrolled);
        view.removeEventListener('pointerenter', enter);
        view.removeEventListener('pointerleave', leave);
        resized.disconnect();
        changed.disconnect();
        bars.forEach((b) => b.track.remove());
      });
    });
  }
}

/** One bar over `view`, in `parent`: its track and thumb, laid out again by `update`. */
function bar(view: HTMLElement, parent: HTMLElement, axis: Axis) {
  const track = document.createElement('div');
  track.className = `r-scrollbar ${axis}`;
  const thumb = document.createElement('div');
  thumb.className = 'thumb';
  track.append(thumb);
  parent.append(track);
  const y = axis === 'y';
  const span = () => (y ? view.clientHeight : view.clientWidth);
  const full = () => (y ? view.scrollHeight : view.scrollWidth);
  const at = () => (y ? view.scrollTop : view.scrollLeft);
  const scrollTo = (value: number) => (y ? (view.scrollTop = value) : (view.scrollLeft = value));
  const thumbSize = () => Math.max(MIN_THUMB, (span() * span()) / full());

  const update = () => {
    const room = full() - span();
    track.hidden = room <= 0;
    if (room <= 0) return;
    const box = {
      top: view.offsetTop,
      left: view.offsetLeft,
      w: view.clientWidth,
      h: view.clientHeight,
    };
    Object.assign(
      track.style,
      y
        ? {
            top: `${box.top}px`,
            left: `${box.left + box.w - SIZE}px`,
            width: `${SIZE}px`,
            height: `${box.h}px`,
          }
        : {
            top: `${box.top + box.h - SIZE}px`,
            left: `${box.left}px`,
            width: `${box.w}px`,
            height: `${SIZE}px`,
          },
    );
    const size = thumbSize();
    const offset = (at() / room) * (span() - size);
    Object.assign(
      thumb.style,
      y ? { top: `${offset}px`, height: `${size}px` } : { left: `${offset}px`, width: `${size}px` },
    );
  };

  thumb.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    event.stopPropagation();
    thumb.setPointerCapture(event.pointerId);
    thumb.classList.add('dragging');
    const from = y ? event.clientY : event.clientX;
    const start = at();
    const ratio = (full() - span()) / (span() - thumbSize());
    const move = (e: PointerEvent) =>
      scrollTo(start + ((y ? e.clientY : e.clientX) - from) * ratio);
    thumb.addEventListener('pointermove', move);
    thumb.addEventListener(
      'pointerup',
      () => {
        thumb.removeEventListener('pointermove', move);
        thumb.classList.remove('dragging');
      },
      { once: true },
    );
  });
  // a click on the track turns a page towards it
  track.addEventListener('pointerdown', (event) => {
    if (event.target !== track) return;
    const box = thumb.getBoundingClientRect();
    const before = y ? event.clientY < box.top : event.clientX < box.left;
    scrollTo(at() + (before ? -1 : 1) * span() * 0.9);
  });
  return { track, update };
}
