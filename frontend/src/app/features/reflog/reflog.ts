import {
  Component,
  HostListener,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { TPipe } from '../../core/i18n/t.pipe';
import { RefLogEntry } from '../../core/models/repository';
import { RepositoryService } from '../../core/services/repository.service';
import { fullDate, when } from '../../shared/when';
import { MenusService } from '../repository-tab/menus.service';

/** The moves that rewrite where a branch is: worth a second look. */
const REWRITES = /^(reset|rebase|commit \(amend\))/;

/**
 * Where HEAD has been, the last move first: a commit a reset or a rebase seems to have lost
 * is found again here, checked out, given a branch, or reset to.
 */
@Component({
  selector: 'app-reflog',
  template: `
    <section class="panel">
      <header class="head">
        <span class="mode">{{ 'Reflog' | t }}</span>
        <span class="hint">{{ 'Where HEAD has been, the last move first' | t }}</span>
        <span class="space"></span>
        <button
          class="r-bar-btn icon"
          (click)="close()"
          [attr.aria-label]="'Back to the history (Esc)' | t"
          [title]="'Back to the history (Esc)' | t"
        >
          <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M1.5 1.5l7 7M8.5 1.5l-7 7" /></svg>
        </button>
      </header>
      <ol class="entries">
        @if (failure(); as failure) {
          <li class="note error">{{ failure }}</li>
        } @else if (entries(); as entries) {
          @for (entry of entries; track $index) {
            @let shown = inHistory().has(entry.id);
            <li
              class="entry"
              [class.picked]="entry.id === repository.selectedId()"
              [class.away]="!shown"
              (click)="pick(entry)"
              (contextmenu)="menus.open($event, menus.forReflog(entry))"
              [title]="shown ? '' : ('Not in the history shown: its menu brings it back' | t)"
            >
              <span class="at r-mono">{{ selector($index) }}</span>
              <span class="action" [class.rewrite]="rewrites(entry)">{{ entry.action }}</span>
              <span class="message">{{ entry.message }}</span>
              <span class="sha r-mono">{{ entry.id.slice(0, 7) }}</span>
              <span class="when" [title]="fullDate(entry.time)">{{ when(entry.time) }}</span>
              <button
                class="more"
                (click)="
                  $event.stopPropagation();
                  menus.openUnder($any($event.currentTarget), menus.forReflog(entry))
                "
                [attr.aria-label]="'More' | t"
              >
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <circle cx="8" cy="3.5" r="1.2" />
                  <circle cx="8" cy="8" r="1.2" />
                  <circle cx="8" cy="12.5" r="1.2" />
                </svg>
              </button>
            </li>
          } @empty {
            <li class="note">{{ 'HEAD has not moved yet.' | t }}</li>
          }
        } @else {
          <li class="note">{{ 'Reading…' | t }}</li>
        }
      </ol>
    </section>
  `,
  styles: `
    .panel {
      height: 100%;
      display: flex;
      flex-direction: column;
      background: var(--r-void);
    }
    .head {
      flex: none;
      height: var(--r-panel-head);
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 0 6px 0 16px;
      border-bottom: 1px solid var(--r-line);
      background: var(--r-base);
      white-space: nowrap;
    }
    .mode {
      color: var(--r-text-3);
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .hint {
      overflow: hidden;
      color: var(--r-text-3);
      font-size: 12px;
      text-overflow: ellipsis;
    }
    .space {
      flex: 1;
    }
    .icon {
      width: 30px;
      padding: 0;
      justify-content: center;
      svg {
        width: 10px;
        height: 10px;
      }
    }
    .entries {
      flex: 1;
      min-height: 0;
      margin: 0;
      padding: 4px 0;
      overflow-y: auto;
      list-style: none;
    }
    .entry {
      height: var(--r-row);
      display: grid;
      grid-template-columns: 92px 150px minmax(0, 1fr) auto 110px 28px;
      align-items: center;
      gap: 12px;
      padding: 0 8px 0 16px;
      white-space: nowrap;
      cursor: pointer;
      &:hover {
        background: var(--r-hover);
        .more {
          opacity: 1;
        }
      }
      &.picked {
        background: var(--r-raised);
        box-shadow: inset 2px 0 var(--r-accent);
      }
      &.away > :not(.more) {
        opacity: 0.55;
      }
    }
    .at,
    .sha,
    .when {
      color: var(--r-text-3);
      font-size: 12px;
    }
    .action {
      overflow: hidden;
      color: var(--r-text-2);
      text-overflow: ellipsis;
      &.rewrite {
        color: var(--r-lane-1);
      }
    }
    .message {
      overflow: hidden;
      color: var(--r-text);
      text-overflow: ellipsis;
    }
    .when {
      text-align: right;
    }
    .more {
      width: 28px;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      border: 0;
      border-radius: var(--r-radius);
      background: transparent;
      color: var(--r-text-3);
      opacity: 0;
      cursor: pointer;
      svg {
        width: 14px;
        height: 14px;
        fill: currentColor;
      }
      &:hover {
        background: var(--r-line);
        color: var(--r-text);
      }
    }
    .note {
      padding: 32px 0;
      color: var(--r-text-3);
      text-align: center;
      &.error {
        color: var(--r-danger);
        user-select: text;
      }
    }
  `,
  imports: [TPipe],
})
export class Reflog {
  protected readonly repository = inject(RepositoryService);
  protected readonly menus = inject(MenusService);
  protected readonly when = when;
  protected readonly fullDate = fullDate;
  protected readonly entries = signal<RefLogEntry[] | null>(null);
  protected readonly failure = signal<string | null>(null);
  protected readonly inHistory = computed(
    () => new Set(this.repository.snapshot()?.commits.map((c) => c.id) ?? []),
  );

  constructor() {
    // read again each time the repository changes: a move just made shows at once
    effect(() => {
      this.repository.snapshot();
      untracked(() => void this.read());
    });
  }

  @HostListener('document:keydown.escape', ['$event'])
  protected escape(event: Event) {
    if (event.defaultPrevented || !this.repository.active()) return;
    this.close();
  }

  protected close() {
    this.repository.reflogOpen.set(false);
  }

  /** How git names the entry: `HEAD@{2}`, two moves ago. */
  protected selector(index: number): string {
    return `HEAD@{${index}}`;
  }

  protected rewrites(entry: RefLogEntry): boolean {
    return REWRITES.test(entry.action);
  }

  /** Selects the entry's commit, when the history shows it. */
  protected pick(entry: RefLogEntry) {
    if (this.inHistory().has(entry.id)) this.repository.select(entry.id);
  }

  private async read() {
    const path = this.repository.snapshot()?.path;
    if (!path) return;
    try {
      this.entries.set(await invoke<RefLogEntry[]>('reflog', { path }));
      this.failure.set(null);
    } catch (e) {
      this.failure.set(String(e));
    }
  }
}
