import { Component, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { TPipe } from '../../core/i18n/t.pipe';
import { RepositoryService } from '../../core/services/repository.service';

interface Choice {
  name: string;
  remote: boolean;
  head: boolean;
}

/** The current branch, and a searchable list of the others to switch to. */
@Component({
  selector: 'app-branch-picker',
  template: `
    <button
      class="trigger"
      [class.open]="open()"
      (click)="toggle()"
      [disabled]="repository.working()"
      [title]="'Switch to another branch' | t"
    >
      <span class="caption">{{ 'Branch' | t }}</span>
      <span class="value">
        <span class="r-mono">{{ head() }}</span>
        <svg class="caret" viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4" /></svg>
      </span>
    </button>
    @if (open()) {
      <div class="backdrop" (click)="open.set(false)"></div>
      <div class="r-popover" (keydown)="key($event)">
        <input
          #search
          class="search"
          [value]="query()"
          (input)="query.set($any($event.target).value); cursor.set(0)"
          [placeholder]="'Search a branch' | t"
          spellcheck="false"
        />
        <ul>
          @for (choice of choices(); track choice.remote + choice.name; let i = $index) {
            <li>
              <button
                [class.cursor]="i === cursor()"
                [class.head]="choice.head"
                (mouseenter)="cursor.set(i)"
                (click)="choose(choice)"
              >
                @if (choice.remote) {
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M4.5 12.5h7a3 3 0 0 0 .4-6 4 4 0 0 0-7.7 1A2.5 2.5 0 0 0 4.5 12.5z" />
                  </svg>
                } @else if (choice.head) {
                  <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3 3 7-7" /></svg>
                } @else {
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <circle cx="5" cy="3.5" r="1.6" />
                    <circle cx="5" cy="12.5" r="1.6" />
                    <circle cx="11" cy="5.5" r="1.6" />
                    <path d="M5 5.1v5.8M11 7.1c0 2.4-3 2.6-5.4 4" />
                  </svg>
                }
                <span class="name">{{ choice.name }}</span>
              </button>
            </li>
          } @empty {
            <li class="none">{{ 'No branch by that name' | t }}</li>
          }
        </ul>
      </div>
    }
  `,
  styles: `
    :host {
      position: relative;
      min-width: 0;
    }
    .trigger {
      min-width: 0;
      max-width: 280px;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 2px;
      padding: 4px 8px;
      border: 0;
      border-radius: var(--r-radius);
      background: transparent;
      text-align: left;
      cursor: pointer;
      &:hover:not(:disabled),
      &.open {
        background: var(--r-hover);
      }
    }
    .caption {
      color: var(--r-text-3);
      font-size: 11px;
    }
    .value {
      max-width: 100%;
      display: flex;
      align-items: center;
      gap: 8px;
      .r-mono {
        overflow: hidden;
        font-size: 14px;
        font-weight: 600;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    }
    .caret {
      flex: none;
      width: 10px;
      height: 6px;
      fill: none;
      stroke: var(--r-text-3);
      stroke-width: 1.4;
    }
    .backdrop {
      position: fixed;
      inset: 0;
      z-index: 10;
    }
    .r-popover {
      top: calc(100% + 6px);
      left: 0;
      width: 320px;
      gap: 8px;
      padding: 8px;
    }
    .search {
      width: 100%;
      padding: 8px 10px;
      border: 1px solid var(--r-accent);
      border-radius: var(--r-radius);
      background: var(--r-void);
      color: var(--r-text);
      font: inherit;
      user-select: text;
      &:focus {
        outline: none;
      }
      &::placeholder {
        color: var(--r-text-3);
      }
    }
    ul {
      max-height: 420px;
      margin: 0;
      padding: 0;
      overflow-y: auto;
      list-style: none;
    }
    li button {
      width: 100%;
      height: 30px;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 0 8px;
      border: 0;
      border-radius: var(--r-radius);
      background: transparent;
      color: var(--r-text-2);
      text-align: left;
      cursor: pointer;
      &.cursor {
        background: var(--r-hover);
        color: var(--r-text);
      }
      &.head {
        color: var(--r-accent);
        font-weight: 600;
      }
      svg {
        flex: none;
        width: 14px;
        height: 14px;
        fill: none;
        stroke: currentColor;
        stroke-width: 1.4;
        stroke-linecap: round;
        stroke-linejoin: round;
        circle {
          fill: currentColor;
          stroke: none;
        }
      }
    }
    .name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .none {
      padding: 6px 8px;
      color: var(--r-text-3);
    }
  `,
  imports: [TPipe],
})
export class BranchPicker {
  protected readonly repository = inject(RepositoryService);
  protected readonly open = signal(false);
  protected readonly query = signal('');
  /** The choice Enter takes, moved with the arrow keys. */
  protected readonly cursor = signal(0);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly search = viewChild<ElementRef<HTMLInputElement>>('search');

  protected readonly head = computed(() => {
    const head = this.repository.snapshot()?.head;
    if (!head) return '';
    return head.kind === 'detached' ? head.id.slice(0, 7) : head.name;
  });

  /** HEAD's branch, the other local ones, then the remote ones with no local branch yet. */
  protected readonly choices = computed<Choice[]>(() => {
    const snapshot = this.repository.snapshot();
    if (!snapshot) return [];
    const head = snapshot.head.kind === 'branch' ? snapshot.head.name : null;
    const local = new Set(snapshot.branches.map((b) => b.name));
    const all: Choice[] = [
      ...snapshot.branches
        .map((b) => ({ name: b.name, remote: false, head: b.name === head }))
        .sort((a, b) => +b.head - +a.head),
      ...snapshot.remoteBranches
        .filter((b) => !local.has(b.name.slice(b.name.indexOf('/') + 1)))
        .map((b) => ({ name: b.name, remote: true, head: false })),
    ];
    const words = this.query().toLowerCase().split(/\s+/).filter(Boolean);
    return all.filter((c) => words.every((w) => c.name.toLowerCase().includes(w)));
  });

  constructor() {
    effect(() => this.search()?.nativeElement.focus());
  }

  protected toggle() {
    this.open.set(!this.open());
    this.query.set('');
    this.cursor.set(0);
  }

  protected key(event: KeyboardEvent) {
    const count = this.choices().length;
    if (event.key === 'Escape') this.open.set(false);
    else if (event.key === 'ArrowDown' && count) this.move((this.cursor() + 1) % count);
    else if (event.key === 'ArrowUp' && count) this.move((this.cursor() - 1 + count) % count);
    else if (event.key === 'Enter' && count) this.choose(this.choices()[this.cursor()]);
    else return;
    event.preventDefault();
  }

  /** Moves the cursor, keeping its choice in view once drawn. */
  private move(index: number) {
    this.cursor.set(index);
    requestAnimationFrame(() =>
      this.host.nativeElement.querySelector('.cursor')?.scrollIntoView({ block: 'nearest' }),
    );
  }

  protected async choose(choice: Choice) {
    this.open.set(false);
    if (!choice.head) await this.repository.checkout(choice.name, choice.remote);
  }
}
