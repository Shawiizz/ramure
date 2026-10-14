import { Component, DestroyRef, computed, effect, inject, input, signal } from '@angular/core';
import { TPipe } from '../../core/i18n/t.pipe';

/** The images the diff shows as images, by their extension and type. */
const IMAGES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
};

/** Whether the file at `path` is an image the diff shows as one. */
export function isImage(path: string): boolean {
  return extension(path) in IMAGES;
}

/** One version of the image: where it is shown from, its size in bytes, then in pixels. */
interface Shown {
  url: string;
  bytes: number;
}

/**
 * An image before and after a change: side by side, or one over the other, a line dragged
 * across showing the one on its left and the other on its right.
 */
@Component({
  selector: 'app-image-diff',
  template: `
    <div class="tools">
      <div class="r-seg" role="radiogroup" [attr.aria-label]="'View' | t">
        <button role="radio" [attr.aria-checked]="!swiping()" (click)="swipe.set(false)">
          {{ 'Side by side' | t }}
        </button>
        <button
          role="radio"
          [attr.aria-checked]="swiping()"
          [disabled]="!both()"
          (click)="swipe.set(true)"
          [title]="'Drag across to see one, then the other' | t"
        >
          {{ 'Swipe' | t }}
        </button>
      </div>
    </div>
    @let before = shown().old;
    @let after = shown().new;
    @if (swiping() && before && after) {
      <div class="swipe">
        <div class="stage checker" (pointerdown)="drag($event)">
          <img [src]="after.url" alt="" draggable="false" (load)="measure('new', $event)" />
          <img
            (load)="measure('old', $event)"
            class="over"
            [src]="before.url"
            alt=""
            draggable="false"
            [style.clip-path]="'inset(0 ' + (100 - split()) + '% 0 0)'"
          />
          <div class="line" [style.left.%]="split()"></div>
        </div>
        <div class="captions">
          <span>{{ 'Before' | t }} · {{ describe(before, 'old') }}</span>
          <span>{{ 'After' | t }} · {{ describe(after, 'new') }}</span>
        </div>
      </div>
    } @else {
      <div class="sides">
        @if (before) {
          <figure>
            <div class="stage checker">
              <img [src]="before.url" alt="" (load)="measure('old', $event)" />
            </div>
            <figcaption>
              <span class="minus">{{ 'Before' | t }}</span> · {{ describe(before, 'old') }}
            </figcaption>
          </figure>
        }
        @if (after) {
          <figure>
            <div class="stage checker">
              <img [src]="after.url" alt="" (load)="measure('new', $event)" />
            </div>
            <figcaption>
              <span class="plus">{{ 'After' | t }}</span> · {{ describe(after, 'new') }}
            </figcaption>
          </figure>
        }
      </div>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      background: var(--r-void);
    }
    .tools {
      flex: none;
      height: 40px;
      display: flex;
      align-items: center;
      padding: 0 10px;
      border-bottom: 1px solid var(--r-line);
      background: var(--r-base);
    }
    .sides {
      flex: 1;
      min-height: 0;
      display: flex;
      gap: 16px;
      padding: 16px;
    }
    figure {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin: 0;
    }
    .stage {
      position: relative;
      flex: 1;
      min-height: 0;
      overflow: hidden;
      border: 1px solid var(--r-line);
      border-radius: var(--r-radius);
      img {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: contain;
        user-select: none;
      }
    }
    /* side by side, each at its own size, made smaller only to fit */
    .sides .stage img {
      object-fit: scale-down;
    }
    /* transparent pixels show as a checkerboard */
    .checker {
      background: repeating-conic-gradient(var(--r-raised) 0 25%, var(--r-base) 0 50%) 0 0 / 16px
        16px;
    }
    figcaption,
    .captions {
      color: var(--r-text-3);
      font-size: 12px;
      text-align: center;
    }
    .minus {
      color: rgb(var(--r-removed-rgb));
    }
    .plus {
      color: rgb(var(--r-added-rgb));
    }
    .swipe {
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 16px;
      .stage {
        cursor: ew-resize;
      }
    }
    .captions {
      display: flex;
      justify-content: space-between;
    }
    .line {
      position: absolute;
      top: 0;
      bottom: 0;
      width: 2px;
      margin-left: -1px;
      background: var(--r-accent);
      box-shadow: 0 0 0 1px rgb(0 0 0 / 0.4);
      pointer-events: none;
    }
  `,
  imports: [TPipe],
})
export class ImageDiff {
  readonly path = input.required<string>();
  readonly old = input<Uint8Array | null>(null);
  readonly new = input<Uint8Array | null>(null);
  protected readonly swipe = signal(false);
  /** Where the line is, in percent of the image's width from its left. */
  protected readonly split = signal(50);
  private readonly sizes = signal<Record<'old' | 'new', string | null>>({ old: null, new: null });
  protected readonly both = computed(() => !!this.old() && !!this.new());
  protected readonly swiping = computed(() => this.swipe() && this.both());

  protected readonly shown = computed(() => {
    const type = IMAGES[extension(this.path())] ?? 'application/octet-stream';
    const show = (bytes: Uint8Array | null): Shown | null =>
      bytes && {
        url: URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type })),
        bytes: bytes.length,
      };
    return { old: show(this.old()), new: show(this.new()) };
  });

  constructor() {
    // an image no longer shown frees its memory
    let urls: string[] = [];
    const free = () => urls.forEach((url) => URL.revokeObjectURL(url));
    effect(() => {
      const { old, new: next } = this.shown();
      free();
      urls = [old?.url, next?.url].filter((url): url is string => !!url);
      this.sizes.set({ old: null, new: null });
    });
    inject(DestroyRef).onDestroy(free);
  }

  protected measure(side: 'old' | 'new', event: Event) {
    const image = event.target as HTMLImageElement;
    this.sizes.update((sizes) => ({
      ...sizes,
      [side]: `${image.naturalWidth} × ${image.naturalHeight}`,
    }));
  }

  /** Its size in pixels once read, and in bytes. */
  protected describe(shown: Shown, side: 'old' | 'new'): string {
    const pixels = this.sizes()[side];
    const bytes = bytesText(shown.bytes);
    return pixels ? `${pixels} · ${bytes}` : bytes;
  }

  /** Moves the line where the pointer is, and with it while held. */
  protected drag(event: PointerEvent) {
    const stage = event.currentTarget as HTMLElement;
    const box = stage.getBoundingClientRect();
    const place = (x: number) =>
      this.split.set(Math.min(100, Math.max(0, ((x - box.left) / box.width) * 100)));
    place(event.clientX);
    stage.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent) => place(e.clientX);
    const stop = () => {
      stage.removeEventListener('pointermove', move);
      stage.removeEventListener('pointerup', stop);
    };
    stage.addEventListener('pointermove', move);
    stage.addEventListener('pointerup', stop);
  }
}

function extension(path: string): string {
  return path.slice(path.lastIndexOf('.') + 1).toLowerCase();
}

function bytesText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
