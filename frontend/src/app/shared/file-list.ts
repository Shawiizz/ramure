import { Component, computed, input, output, signal } from '@angular/core';
import { t } from '../core/i18n/i18n';
import { Change, ChangeKind } from '../core/models/repository';

/** Each kind of change: its letter, its name (in the language of the moment), its colour. */
export const KIND: Record<ChangeKind, { letter: string; title: () => string; color: string }> = {
  added: { letter: 'A', title: () => t('Added'), color: 'rgb(var(--r-added-rgb))' },
  untracked: {
    letter: '?',
    title: () => t('New, not followed yet'),
    color: 'rgb(var(--r-added-rgb))',
  },
  modified: { letter: 'M', title: () => t('Modified'), color: 'var(--r-lane-1)' },
  typeChanged: { letter: 'T', title: () => t('Type changed'), color: 'var(--r-lane-1)' },
  renamed: { letter: 'R', title: () => t('Renamed'), color: 'var(--r-lane-2)' },
  copied: { letter: 'C', title: () => t('Copied'), color: 'var(--r-lane-2)' },
  deleted: { letter: 'D', title: () => t('Deleted'), color: 'rgb(var(--r-removed-rgb))' },
  conflicted: { letter: '!', title: () => t('In conflict'), color: 'rgb(var(--r-removed-rgb))' },
};

/** How many changes of each kind, in the order of the letters. */
export function countKinds(changes: Change[]) {
  const counts = new Map<ChangeKind, number>();
  for (const c of changes) counts.set(c.kind, (counts.get(c.kind) ?? 0) + 1);
  return (Object.keys(KIND) as ChangeKind[])
    .filter((kind) => counts.has(kind))
    .map((kind) => ({ ...KIND[kind], count: counts.get(kind)! }));
}

/** A line of the list: a folder (of the tree) and every change under it, or a file. */
type Row =
  | { kind: 'dir'; key: string; name: string; depth: number; changes: Change[] }
  | { kind: 'file'; key: string; change: Change; depth: number };

interface Folder {
  dirs: Map<string, Folder>;
  files: Change[];
}

/** A changed file right-clicked, and where. */
export interface FileMenu {
  event: MouseEvent;
  change: Change;
}

/**
 * Changed files, as paths or in their folders: a click opens one (again, closes it), a
 * right click asks for its menu; an optional action button on each file or folder (stage,
 * unstage). The rows reach the list's edges, their text inset by `--inset`.
 */
@Component({
  selector: 'app-file-list',
  template: `
    <ul>
      @for (row of rows(); track row.key) {
        @if (row.kind === 'dir') {
          @let folded = collapsed().has(row.key);
          <li [style.--depth]="row.depth">
            <button
              class="file"
              (click)="fold(row.key)"
              [attr.aria-expanded]="!folded"
              [title]="row.key"
            >
              <svg class="chevron" [class.folded]="folded" viewBox="0 0 10 10" aria-hidden="true">
                <path d="M2 3.5l3 3 3-3" />
              </svg>
              <span class="folder">{{ row.name }}</span>
              @if (folded) {
                @for (kind of counts(row.changes); track kind.letter) {
                  <span class="count" [style.color]="kind.color" [title]="kind.title()">
                    <b>{{ kind.letter }}</b
                    >{{ kind.count }}
                  </span>
                }
              }
            </button>
            @if (action(); as action) {
              <button class="act" (click)="acted.emit(row.changes)">{{ action }}</button>
            }
          </li>
        } @else {
          @let change = row.change;
          <li
            [style.--depth]="row.depth"
            [class.open]="change.path === openPath()"
            (contextmenu)="menu.emit({ event: $event, change })"
          >
            <button
              class="file"
              (click)="opened.emit(change)"
              (pointerenter)="pointed.emit(change)"
              [title]="titleOf(change)"
            >
              <span class="kind" [style.color]="kind(change).color">{{ kind(change).letter }}</span>
              <span class="name">{{ nameOf(change.path) }}</span>
              @if (!tree()) {
                <span class="dir">{{ dirOf(change.path) }}</span>
              }
            </button>
            @if (action(); as action) {
              <button class="act" (click)="acted.emit([change])">{{ action }}</button>
            }
          </li>
        }
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
      &:hover {
        background: var(--r-hover);
      }
      &.open {
        background: var(--r-raised);
        box-shadow: inset 2px 0 var(--r-accent);
      }
      &:hover .act {
        visibility: visible;
      }
    }
    .file {
      flex: 1;
      min-width: 0;
      display: flex;
      align-items: center;
      gap: 8px;
      height: 28px;
      padding: 0 8px 0 calc(var(--inset, 8px) + var(--depth, 0) * 14px);
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
    .chevron {
      flex: none;
      width: 10px;
      height: 10px;
      fill: none;
      stroke: var(--r-text-3);
      stroke-width: 1.5;
      stroke-linecap: round;
      stroke-linejoin: round;
      transition: transform var(--r-fast);
      &.folded {
        transform: rotate(-90deg);
      }
    }
    .folder {
      min-width: 0;
      overflow: hidden;
      color: var(--r-text-2);
      text-overflow: ellipsis;
    }
    .count {
      flex: none;
      font: 500 11px var(--r-mono);
      b {
        margin-right: 2px;
      }
    }
    .act {
      visibility: hidden;
      flex: none;
      height: 22px;
      margin-right: calc(var(--inset, 8px) - 4px);
      padding: 0 8px;
      border: 1px solid var(--r-line-strong);
      border-radius: var(--r-radius);
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
  /** The files in their folders, rather than as paths. */
  readonly tree = input(false);
  /** The label of the button on each file and folder, none without it. */
  readonly action = input<string | null>(null);
  /** The file whose diff is on screen. */
  readonly openPath = input<string | null>(null);
  readonly opened = output<Change>();
  /** A file under the pointer: its diff may be read ahead. */
  readonly pointed = output<Change>();
  /** The action asked on a file, or on every file of a folder. */
  readonly acted = output<Change[]>();
  readonly menu = output<FileMenu>();
  /** The folders folded away, by path. */
  protected readonly collapsed = signal(new Set<string>());
  protected readonly counts = countKinds;

  protected readonly rows = computed<Row[]>(() => {
    const changes = this.changes();
    if (!this.tree()) {
      return changes.map((change) => ({ kind: 'file', key: change.path, change, depth: 0 }));
    }
    const root: Folder = { dirs: new Map(), files: [] };
    for (const change of changes) {
      const parts = change.path.split('/');
      let folder = root;
      for (const part of parts.slice(0, -1)) {
        if (!folder.dirs.has(part)) folder.dirs.set(part, { dirs: new Map(), files: [] });
        folder = folder.dirs.get(part)!;
      }
      folder.files.push(change);
    }
    const collapsed = this.collapsed();
    const rows: Row[] = [];
    const walk = (folder: Folder, prefix: string, depth: number) => {
      for (const [part, child] of [...folder.dirs].sort(([a], [b]) => a.localeCompare(b))) {
        // a folder holding one folder only shows as one line: `src/app`
        let name = part;
        let inner = child;
        while (!inner.files.length && inner.dirs.size === 1) {
          const [next, deeper] = [...inner.dirs][0];
          name += `/${next}`;
          inner = deeper;
        }
        const key = prefix + name;
        rows.push({ kind: 'dir', key, name, depth, changes: everything(inner) });
        if (!collapsed.has(key)) walk(inner, `${key}/`, depth + 1);
      }
      const files = [...folder.files].sort((a, b) =>
        this.nameOf(a.path).localeCompare(this.nameOf(b.path)),
      );
      for (const change of files) rows.push({ kind: 'file', key: change.path, change, depth });
    };
    walk(root, '', 0);
    return rows;
  });

  protected fold(key: string) {
    this.collapsed.update((keys) => {
      const next = new Set(keys);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }

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
    return `${this.kind(change).title()}: ${change.path}${from}`;
  }
}

/** Every change under a folder, however deep. */
function everything(folder: Folder): Change[] {
  return [...folder.files, ...[...folder.dirs.values()].flatMap(everything)];
}
