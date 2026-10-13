import {
  Component,
  ElementRef,
  HostListener,
  afterNextRender,
  inject,
  input,
  output,
  signal,
} from '@angular/core';

/** An entry of a menu: an action, a submenu, or a separator (null). */
export type MenuEntry = MenuItem | null;

export interface MenuItem {
  label: string;
  run?: () => void;
  /** Its entries shown beside it, under the pointer. */
  children?: MenuEntry[];
  disabled?: boolean;
  /** An action that throws something away. */
  danger?: boolean;
  /** A setting that is on: a tick beside it. */
  checked?: boolean;
}

/** A menu at the pointer, kept inside the window; it closes on a choice, Esc or a click away. */
@Component({
  selector: 'app-context-menu',
  template: `
    <div class="backdrop" (mousedown)="closed.emit()" (contextmenu)="away($event)"></div>
    <ul class="menu" role="menu" [style.left.px]="left()" [style.top.px]="top()">
      @for (entry of entries(); track $index) {
        @if (entry) {
          <li
            role="menuitem"
            [class.disabled]="entry.disabled"
            [class.danger]="entry.danger"
            [class.parent]="entry.children"
            [attr.aria-disabled]="entry.disabled"
            (mouseenter)="open.set(entry.children ? $index : null)"
            (click)="choose(entry)"
          >
            <span class="label">
              @if (entry.checked !== undefined) {
                <svg class="tick" [class.on]="entry.checked" viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M3 8.5l3 3 7-7" />
                </svg>
              }
              {{ entry.label }}
            </span>
            @if (entry.children) {
              <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M3 2l3.5 3L3 8" /></svg>
              @if (open() === $index) {
                <ul class="menu sub" [class.leftward]="leftward()" role="menu">
                  @for (child of entry.children; track $index) {
                    @if (child) {
                      <li
                        role="menuitem"
                        [class.disabled]="child.disabled"
                        [class.danger]="child.danger"
                        [attr.aria-disabled]="child.disabled"
                        (click)="$event.stopPropagation(); choose(child)"
                      >
                        <span>{{ child.label }}</span>
                      </li>
                    } @else {
                      <li class="separator" role="separator"></li>
                    }
                  }
                </ul>
              }
            }
          </li>
        } @else {
          <li class="separator" role="separator"></li>
        }
      }
    </ul>
  `,
  styles: `
    .backdrop {
      position: fixed;
      inset: 0;
      z-index: 40;
    }
    .menu {
      position: fixed;
      z-index: 41;
      min-width: 240px;
      margin: 0;
      padding: 5px;
      list-style: none;
      border: 1px solid var(--r-line-strong);
      border-radius: var(--r-radius-panel);
      background: var(--r-raised);
      box-shadow: 0 14px 36px rgb(0 0 0 / 0.45);
    }
    .sub {
      position: absolute;
      top: -6px;
      left: calc(100% + 4px);
      &.leftward {
        left: auto;
        right: calc(100% + 4px);
      }
    }
    li {
      position: relative;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 24px;
      padding: 0 10px;
      border-radius: var(--r-radius);
      color: var(--r-text);
      white-space: nowrap;
      cursor: pointer;
      &:hover:not(.disabled):not(.separator),
      &.parent:has(.sub) {
        background: var(--r-hover);
      }
      &.danger {
        color: var(--r-danger);
      }
      &.disabled {
        color: var(--r-text-3);
        cursor: default;
      }
      svg {
        width: 10px;
        height: 10px;
        fill: none;
        stroke: var(--r-text-3);
        stroke-width: 1.4;
      }
    }
    .label {
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }
    .tick {
      width: 14px;
      height: 14px;
      fill: none;
      stroke: transparent;
      stroke-width: 1.8;
      stroke-linecap: round;
      stroke-linejoin: round;
      &.on {
        stroke: var(--r-accent);
      }
    }
    .separator {
      height: 1px;
      margin: 5px 4px;
      padding: 0;
      background: var(--r-line);
      cursor: default;
    }
  `,
})
export class ContextMenu {
  readonly entries = input.required<MenuEntry[]>();
  /** Where the pointer was, in the window. */
  readonly x = input.required<number>();
  readonly y = input.required<number>();
  readonly closed = output();
  /** Where the menu goes once its size is known, before it is painted. */
  protected readonly left = signal(0);
  protected readonly top = signal(0);
  /** The submenu open, by the index of its entry. */
  protected readonly open = signal<number | null>(null);
  /** Submenus open on the left when the right has no room. */
  protected readonly leftward = signal(false);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  constructor() {
    afterNextRender(() => {
      const menu = this.host.nativeElement.querySelector('.menu')!.getBoundingClientRect();
      const margin = 8;
      this.left.set(Math.max(margin, Math.min(this.x(), innerWidth - menu.width - margin)));
      this.top.set(Math.max(margin, Math.min(this.y(), innerHeight - menu.height - margin)));
      this.leftward.set(this.left() + menu.width * 2 > innerWidth);
    });
  }

  @HostListener('document:keydown.escape')
  protected escape() {
    this.closed.emit();
  }

  /** A right click away closes this menu, and lets the page open its own. */
  protected away(event: MouseEvent) {
    event.preventDefault();
    this.closed.emit();
  }

  protected choose(entry: MenuItem) {
    if (entry.disabled || entry.children) return;
    this.closed.emit();
    entry.run?.();
  }
}
