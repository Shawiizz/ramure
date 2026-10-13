import { Component, input, output } from '@angular/core';
import { t } from '../core/i18n/i18n';
import { Change, ChangeKind } from '../core/models/repository';

const KIND: Record<ChangeKind, { letter: string; title: string; color: string }> = {
  added: { letter: 'A', title: t('Added'), color: 'var(--r-lane-0)' },
  untracked: { letter: '?', title: t('New, not followed yet'), color: 'var(--r-lane-0)' },
  modified: { letter: 'M', title: t('Modified'), color: 'var(--r-lane-1)' },
  typeChanged: { letter: 'T', title: t('Type changed'), color: 'var(--r-lane-1)' },
  renamed: { letter: 'R', title: t('Renamed'), color: 'var(--r-lane-2)' },
  copied: { letter: 'C', title: t('Copied'), color: 'var(--r-lane-2)' },
  deleted: { letter: 'D', title: t('Deleted'), color: 'var(--r-lane-3)' },
  conflicted: { letter: '!', title: t('In conflict'), color: 'var(--r-lane-3)' },
};

/** Changed files: a click opens one; an optional action button on each (stage, unstage). */
@Component({
  selector: 'app-file-list',
  template: `
    <ul>
      @for (change of changes(); track change.path) {
        <li [class.open]="change.path === openPath()">
          <button class="file" (click)="opened.emit(change)" [title]="titleOf(change)">
            <span class="kind" [style.color]="kind(change).color">{{ kind(change).letter }}</span>
            <span class="name">{{ nameOf(change.path) }}</span>
            <span class="dir">{{ dirOf(change.path) }}</span>
          </button>
          @if (action(); as action) {
            <button class="act" (click)="acted.emit(change)">{{ action }}</button>
          }
        </li>
      }
    </ul>
  `,
  styles: `
    ul {
      margin: 0;
      padding: 0;
      list-style: none;
    }
    li {
      display: flex;
      align-items: center;
      border-radius: 4px;
      &:hover,
      &.open {
        background: var(--r-hover);
      }
      &:hover .act {
        visibility: visible;
      }
    }
    .file {
      flex: 1;
      min-width: 0;
      display: flex;
      align-items: baseline;
      gap: 8px;
      height: 28px;
      padding: 0 8px;
      border: 0;
      background: transparent;
      text-align: left;
      cursor: pointer;
      white-space: nowrap;
    }
    .kind {
      flex: none;
      width: 10px;
      font: 700 12px var(--r-mono);
    }
    .name {
      flex: none;
      max-width: 70%;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .dir {
      min-width: 0;
      overflow: hidden;
      color: var(--r-text-3);
      font-size: 12px;
      text-overflow: ellipsis;
      direction: rtl;
      text-align: left;
    }
    .act {
      visibility: hidden;
      flex: none;
      height: 22px;
      margin-right: 4px;
      padding: 0 8px;
      border: 1px solid var(--r-line-strong);
      border-radius: 4px;
      background: var(--r-raised);
      font-size: 12px;
      cursor: pointer;
      &:hover {
        border-color: var(--r-accent);
      }
      &:focus-visible {
        visibility: visible;
      }
    }
  `,
})
export class FileList {
  readonly changes = input.required<Change[]>();
  /** The label of the button on each file, none without it. */
  readonly action = input<string | null>(null);
  /** The file whose diff is on screen. */
  readonly openPath = input<string | null>(null);
  readonly opened = output<Change>();
  readonly acted = output<Change>();

  protected kind(change: Change) {
    return KIND[change.kind];
  }

  protected nameOf(path: string): string {
    return path.slice(path.lastIndexOf('/') + 1);
  }

  protected dirOf(path: string): string {
    return path.slice(0, Math.max(path.lastIndexOf('/'), 0));
  }

  protected titleOf(change: Change): string {
    const from = change.oldPath ? ` ← ${change.oldPath}` : '';
    return `${this.kind(change).title}: ${change.path}${from}`;
  }
}
