import { Component, ElementRef, HostListener, signal, viewChild } from '@angular/core';

/** How long the pointer rests on something before its tip shows. */
const DELAY_MS = 450;
/** Once a tip has shown, the next ones come at once for this long after it goes. */
const WARM_MS = 600;
/** Room kept between a tip and what it is about, or the window's edge. */
const GAP = 6;

interface Tip {
  text: string;
  /** Where the tip's middle goes, and its top (its bottom when above). */
  x: number;
  y: number;
  above: boolean;
  /** Laid out but not shown yet: measured to be kept inside the window. */
  measuring: boolean;
}

/**
 * The app's tooltips, in its own style rather than the system's: every `title` in the
 * page shows this way. A title is moved to `data-tip` once pointed at, which keeps the
 * system's tooltip away; the text stays for screen readers as a description.
 */
@Component({
  selector: 'app-tooltip',
  template: `
    @if (tip(); as tip) {
      <div
        #box
        class="tip"
        role="tooltip"
        [class.measuring]="tip.measuring"
        [class.above]="tip.above"
        [style.left.px]="tip.x"
        [style.top.px]="tip.y"
      >
        {{ tip.text }}
      </div>
    }
  `,
  styles: `
    .tip {
      position: fixed;
      z-index: 1000;
      max-width: 340px;
      padding: 5px 9px;
      border: 1px solid var(--r-line-strong);
      border-radius: var(--r-radius);
      background: var(--r-raised);
      box-shadow: 0 6px 18px rgb(0 0 0 / 0.35);
      color: var(--r-text);
      font: 12px/1.45 var(--r-font);
      white-space: pre-line;
      overflow-wrap: anywhere;
      pointer-events: none;
      transform: translateX(-50%);
      animation: show var(--r-fast) ease-out;
      &.above {
        transform: translate(-50%, -100%);
      }
      &.measuring {
        visibility: hidden;
        animation: none;
      }
    }
    @keyframes show {
      from {
        opacity: 0;
      }
    }
  `,
})
export class Tooltip {
  protected readonly tip = signal<Tip | null>(null);
  private readonly box = viewChild<ElementRef<HTMLElement>>('box');
  private target: Element | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private warmUntil = 0;

  @HostListener('document:pointerover', ['$event'])
  protected over(event: PointerEvent) {
    const found = (event.target as Element).closest?.('[title], [data-tip]') ?? null;
    if (found === this.target) return;
    this.hide();
    const text = found && take(found);
    if (!found || !text) return;
    this.target = found;
    if (Date.now() < this.warmUntil) this.show(found, text);
    else this.timer = setTimeout(() => this.show(found, text), DELAY_MS);
  }

  @HostListener('document:pointerout', ['$event'])
  protected out(event: PointerEvent) {
    // out of the window altogether
    if (!event.relatedTarget) this.hide();
  }

  @HostListener('document:pointerdown')
  @HostListener('document:keydown')
  @HostListener('document:wheel')
  protected dismiss() {
    this.hide();
    this.warmUntil = 0;
    // pointed at again, the same element shows its tip again
    this.target = null;
  }

  private show(target: Element, text: string) {
    if (!target.isConnected) return;
    const box = target.getBoundingClientRect();
    const above = box.bottom + 48 > innerHeight;
    const y = above ? box.top - GAP : box.bottom + GAP;
    this.tip.set({ text, x: box.left + box.width / 2, y, above, measuring: true });
    // once laid out, its width keeps it inside the window
    requestAnimationFrame(() => {
      const tip = this.tip();
      const width = this.box()?.nativeElement.offsetWidth;
      if (!tip || width === undefined) return;
      const half = width / 2;
      const x = Math.min(Math.max(tip.x, half + GAP), innerWidth - half - GAP);
      this.tip.set({ ...tip, x, measuring: false });
    });
  }

  private hide() {
    clearTimeout(this.timer);
    if (this.tip()) this.warmUntil = Date.now() + WARM_MS;
    this.tip.set(null);
    this.target = null;
  }
}

/** An element's tip: its title, taken off it so the system shows none, kept in `data-tip`. */
function take(element: Element): string {
  const title = element.getAttribute('title');
  if (title) {
    element.setAttribute('data-tip', title);
    element.removeAttribute('title');
    if (!element.hasAttribute('aria-label')) element.setAttribute('aria-description', title);
  }
  return element.getAttribute('data-tip') ?? '';
}
