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
import { t } from '../../core/i18n/i18n';
import { TPipe } from '../../core/i18n/t.pipe';
import { NewRepositoryService } from '../../core/services/new-repository.service';
import { PreferencesService } from '../../core/services/preferences.service';
import { RepositoryService, WIP } from '../../core/services/repository.service';
import { TabsService, splitPath } from '../../core/services/tabs.service';
import { fuzzy } from '../../shared/fuzzy';
import { pickRepository } from '../../shared/pick';
import { MenusService } from '../repository-tab/menus.service';
import { Picker } from '../toolbar/picker';

type Kind = 'command' | 'branch' | 'remote' | 'repository' | 'file';

/** Something the palette offers: what it shows, what is searched, what it does. */
interface Entry {
  kind: Kind;
  label: string;
  detail?: string;
  /** What the letters typed are looked for in, when more than the label (a file's path). */
  search?: string;
  run: () => void;
}

/** An entry matching what was typed: its label cut into the letters found and the others. */
interface Choice {
  entry: Entry;
  score: number;
  parts: { text: string; lit: boolean }[];
}

/** Entries of a kind come first when they match as well. */
const RANK: Record<Kind, number> = {
  command: 0.6,
  branch: 0.4,
  remote: 0.2,
  repository: 0.3,
  file: 0,
};
/** The most choices listed: what is typed narrows them. */
const SHOWN = 50;

/**
 * Everything at hand, found by a few of its letters (Ctrl+P): the commands, the branches
 * to check out, the repositories to open, the files to look at.
 */
@Component({
  selector: 'app-palette',
  template: `
    @if (open()) {
      <div class="backdrop" (click)="open.set(false)"></div>
      <div
        class="palette"
        role="dialog"
        [attr.aria-label]="'Command palette' | t"
        (keydown)="key($event)"
      >
        <input
          #search
          class="search"
          [value]="query()"
          (input)="query.set($any($event.target).value); cursor.set(0)"
          [placeholder]="'A command, a branch, a repository, a file…' | t"
          spellcheck="false"
        />
        <ul>
          @for (choice of choices(); track choice.entry; let i = $index) {
            <li>
              <button
                [class.cursor]="i === cursor()"
                (mouseenter)="cursor.set(i)"
                (click)="choose(choice)"
              >
                <span class="label">
                  @for (part of choice.parts; track $index) {
                    <span [class.lit]="part.lit">{{ part.text }}</span>
                  }
                </span>
                @if (choice.entry.detail) {
                  <span class="detail">{{ choice.entry.detail }}</span>
                }
                <span class="kind">{{ kinds()[choice.entry.kind] }}</span>
              </button>
            </li>
          } @empty {
            <li class="none">{{ 'Nothing by that name' | t }}</li>
          }
        </ul>
      </div>
    }
  `,
  styles: `
    .backdrop {
      position: fixed;
      inset: 0;
      z-index: 30;
    }
    .palette {
      position: fixed;
      top: 72px;
      left: 50%;
      z-index: 31;
      width: min(640px, calc(100vw - 32px));
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 8px;
      border: 1px solid var(--r-line-strong);
      border-radius: var(--r-radius-panel);
      background: var(--r-raised);
      box-shadow: 0 16px 40px rgb(0 0 0 / 0.55);
      transform: translateX(-50%);
    }
    .search {
      width: 100%;
      padding: 9px 11px;
      border: 1px solid var(--r-accent);
      border-radius: var(--r-radius);
      background: var(--r-void);
      color: var(--r-text);
      font: inherit;
      font-size: 14px;
      user-select: text;
      &:focus {
        outline: none;
      }
      &::placeholder {
        color: var(--r-text-3);
      }
    }
    ul {
      max-height: min(440px, calc(100vh - 180px));
      margin: 0;
      padding: 0;
      overflow-y: auto;
      list-style: none;
    }
    li button {
      width: 100%;
      height: 32px;
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 0 10px;
      border: 0;
      border-radius: var(--r-radius);
      background: transparent;
      color: var(--r-text-2);
      text-align: left;
      white-space: nowrap;
      cursor: pointer;
      &.cursor {
        background: var(--r-hover);
        color: var(--r-text);
      }
    }
    .label {
      flex: none;
      max-width: 60%;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .lit {
      color: var(--r-accent);
      font-weight: 600;
    }
    .detail {
      min-width: 0;
      overflow: hidden;
      color: var(--r-text-3);
      font-size: 12px;
      text-overflow: ellipsis;
    }
    .kind {
      margin-left: auto;
      flex: none;
      color: var(--r-text-3);
      font-size: 11px;
    }
    .none {
      padding: 8px 10px;
      color: var(--r-text-3);
    }
  `,
  imports: [TPipe],
})
export class Palette extends Picker<Choice> {
  private readonly repository = inject(RepositoryService);
  private readonly menus = inject(MenusService);
  private readonly tabs = inject(TabsService);
  private readonly making = inject(NewRepositoryService);
  private readonly preferences = inject(PreferencesService);
  /** The repository's files, read each time the palette opens. */
  private readonly files = signal<string[]>([]);

  protected readonly kinds = computed<Record<Kind, string>>(() => ({
    command: t('Command'),
    branch: t('Branch'),
    remote: t('Remote branch'),
    repository: t('Repository'),
    file: t('File'),
  }));

  private readonly entries = computed<Entry[]>(() => [
    ...this.commands(),
    ...this.branches(),
    ...this.repositories(),
    ...this.files().map((path): Entry => {
      const place = splitPath(path);
      return {
        kind: 'file',
        label: place.name,
        detail: place.parent,
        search: path,
        run: () => this.repository.openFile({ mode: 'history', path }),
      };
    }),
  ]);

  protected readonly choices = computed<Choice[]>(() => {
    const query = this.query().trim();
    // files only once something is typed: there may be thousands
    const entries = this.entries().filter((e) => query || e.kind !== 'file');
    const found: Choice[] = [];
    for (const entry of entries) {
      const search = entry.search ?? entry.label;
      const match = fuzzy(query, search);
      if (!match) continue;
      // the letters found in the label, which ends what is searched
      const shift = search.length - entry.label.length;
      const lit = new Set(match.at.map((i) => i - shift).filter((i) => i >= 0));
      found.push({ entry, score: match.score + RANK[entry.kind], parts: parts(entry.label, lit) });
    }
    if (query) found.sort((a, b) => b.score - a.score);
    return found.slice(0, SHOWN);
  });

  constructor() {
    super();
    effect(() => {
      if (this.open()) untracked(() => void this.readFiles());
      else this.files.set([]);
    });
  }

  @HostListener('document:keydown', ['$event'])
  protected shortcut(event: KeyboardEvent) {
    if (!this.repository.active() || !event.ctrlKey || event.altKey) return;
    if (event.key.toLowerCase() !== 'p') return;
    event.preventDefault();
    this.toggle();
  }

  protected override choose(choice: Choice) {
    this.open.set(false);
    choice.entry.run();
  }

  private async readFiles() {
    const path = this.repository.snapshot()?.path;
    if (!path) return;
    try {
      const files = await invoke<string[]>('files', { path });
      if (this.open()) this.files.set(files);
    } catch (e) {
      this.repository.error.set(String(e));
    }
  }

  private commands(): Entry[] {
    const r = this.repository;
    const m = this.menus;
    const s = r.snapshot();
    const command = (label: string, run: () => void, when = true): Entry[] =>
      when ? [{ kind: 'command', label, run }] : [];
    const app = [
      ...command(t('Open a repository'), () => void this.browse()),
      ...command(t('Clone a repository'), () => this.making.making.set('clone')),
      ...command(t('Create a repository'), () => this.making.making.set('create')),
      ...command(t('New tab'), () => this.tabs.add()),
      ...command(t('Close the tab'), () => this.tabs.close(this.tabs.activeId())),
      ...command(t('Settings'), () => this.preferences.open.set(true)),
    ];
    if (!s) return app;
    const head = r.headId();
    const changes = r.changes() > 0;
    return [
      ...command(t('Fetch'), () => void r.exchangeWith('fetch')),
      ...command(t('Pull'), () => void r.exchangeWith('pull'), !!s.status.upstream),
      ...command(t('Push'), () => m.push()),
      ...command(
        t('Create a branch…'),
        () => m.createBranchAt(head!, head!.slice(0, 7))?.run?.(),
        !!head,
      ),
      ...command(t('Show the changes to commit'), () => r.select(WIP), changes),
      ...command(
        t('Stage all'),
        () => void r.stage([...s.status.unstaged, ...s.status.conflicted].map((c) => c.path)),
        s.status.unstaged.length + s.status.conflicted.length > 0,
      ),
      ...command(
        t('Unstage all'),
        () => void r.unstage(s.status.staged.map((c) => c.path)),
        s.status.staged.length > 0,
      ),
      ...command(t('Stash the changes'), () => void r.stash(), changes),
      ...command(
        t('Pop the last stash'),
        () => void r.restore(s.stashes[0], true),
        s.stashes.length > 0,
      ),
      ...command(t('Discard every change…'), () => m.discardAll(), changes),
      ...command(t('Undo'), () => void r.undo(), r.undoable().length > 0),
      ...command(t('Redo'), () => void r.redo(), r.redoable().length > 0),
      ...command(t('Terminal'), () => r.toggleTerminal()),
      ...command(t('Open in {editor}', { editor: m.editor() }), () => void r.openInEditor(null)),
      ...app,
    ];
  }

  private branches(): Entry[] {
    const s = this.repository.snapshot();
    if (!s) return [];
    const current = s.head.kind === 'branch' ? s.head.name : null;
    return [
      ...s.branches
        .filter((b) => b.name !== current)
        .map((b): Entry => ({
          kind: 'branch',
          label: b.name,
          detail: t('Check out'),
          run: () => void this.repository.checkout(b.name, false),
        })),
      ...s.remoteBranches.map((b): Entry => ({
        kind: 'remote',
        label: b.name,
        detail: t('Check out'),
        run: () => void this.repository.checkout(b.name, true),
      })),
    ];
  }

  private repositories(): Entry[] {
    const current = this.repository.snapshot()?.path;
    return this.tabs
      .recent()
      .filter((path) => path !== current)
      .map((path): Entry => {
        const place = splitPath(path);
        return {
          kind: 'repository',
          label: place.name,
          detail: place.parent,
          run: () => this.tabs.show(this.tabs.activeId(), path),
        };
      });
  }

  private async browse() {
    const path = await pickRepository();
    if (path) this.tabs.show(this.tabs.activeId(), path);
  }
}

/** A label cut into runs of letters found and letters not. */
function parts(label: string, lit: Set<number>): { text: string; lit: boolean }[] {
  const runs: { text: string; lit: boolean }[] = [];
  for (let i = 0; i < label.length; i++) {
    const on = lit.has(i);
    const last = runs[runs.length - 1];
    if (last && last.lit === on) last.text += label[i];
    else runs.push({ text: label[i], lit: on });
  }
  return runs;
}
