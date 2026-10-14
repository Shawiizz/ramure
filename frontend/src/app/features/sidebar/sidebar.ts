import {
  Component,
  ElementRef,
  HostListener,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { t } from '../../core/i18n/i18n';
import { TPipe } from '../../core/i18n/t.pipe';
import { RepositoryService } from '../../core/services/repository.service';
import { GithubService } from '../../core/services/github.service';
import { SettingsService } from '../../core/services/settings.service';
import { MenuEntry } from '../../shared/context-menu';
import { follow } from '../../shared/drag';
import { MenusService } from '../repository-tab/menus.service';
import { ChecksMark } from '../../shared/checks-mark';

type Kind = 'local' | 'remote' | 'pull' | 'tag' | 'stash';

interface Item {
  /** What the list shows: a remote branch without its remote's name. */
  label: string;
  /** The full name, for git. */
  name: string;
  target: string;
}

/** Items under a heading of their own (a remote's branches), or under none. */
interface Group {
  key: string;
  name: string | null;
  items: Item[];
}

interface Section {
  key: Kind;
  title: string;
  count: number;
  groups: Group[];
}

/** A section's list is never made shorter than this. */
const MIN_HEIGHT = 60;

/**
 * The branches, remote branches (by remote), tags and stashes: sections that fold, move
 * and take the height they are given, filtered by name. A click shows a name's commit, a
 * double click switches to a branch, a right click or ⋯ opens its menu; a local branch
 * dropped on another merges or rebases them.
 */
@Component({
  selector: 'app-sidebar',
  templateUrl: './sidebar.html',
  styleUrl: './sidebar.scss',
  imports: [TPipe, ChecksMark],
})
export class Sidebar {
  protected readonly repository = inject(RepositoryService);
  protected readonly menus = inject(MenusService);
  private readonly store = inject(SettingsService);
  private readonly github = inject(GithubService);
  protected readonly collapsed = computed(() => new Set(this.store.settings().collapsed));
  protected readonly heights = computed(() => this.store.layout().heights);
  protected readonly query = signal('');
  private readonly filter = viewChild<ElementRef<HTMLInputElement>>('filter');
  /** The local branch being dragged onto another. */
  protected readonly dragging = signal<string | null>(null);
  /** The section whose heading is being dragged. */
  protected readonly moving = signal<Kind | null>(null);
  protected readonly head = computed(() => {
    const head = this.repository.snapshot()?.head;
    return head?.kind === 'branch' ? head.name : null;
  });
  protected readonly hidden = computed(() => new Set(this.repository.view().hidden));
  protected readonly soloed = computed(() => this.repository.view().solo);

  protected readonly sections = computed<Section[]>(() => {
    const s = this.repository.snapshot();
    if (!s) return [];
    const plain = (items: Item[]): Group[] => [{ key: '', name: null, items }];
    const remotes = new Map<string, Item[]>(s.remotes.map((r) => [r.name, []]));
    for (const b of s.remoteBranches) {
      const cut = b.name.indexOf('/');
      const remote = b.name.slice(0, cut);
      const item = { label: b.name.slice(cut + 1), name: b.name, target: b.target };
      remotes.set(remote, [...(remotes.get(remote) ?? []), item]);
    }
    const named = (b: { name: string; target: string }): Item => ({ label: b.name, ...b });
    const all: Record<Kind, Section> = {
      local: {
        key: 'local',
        title: t('Branches'),
        count: s.branches.length,
        groups: plain(s.branches.map(named)),
      },
      remote: {
        key: 'remote',
        title: t('Remote'),
        count: s.remoteBranches.length,
        groups: [...remotes].map(([name, items]) => ({ key: `remote/${name}`, name, items })),
      },
      pull: {
        key: 'pull',
        title: t('Pull requests'),
        count: this.repository.pulls()?.length ?? 0,
        groups: plain(
          (this.repository.pulls() ?? []).map((pull) => ({
            label: `#${pull.number} ${pull.title}`,
            name: String(pull.number),
            target: pull.headId,
          })),
        ),
      },
      tag: { key: 'tag', title: t('Tags'), count: s.tags.length, groups: plain(s.tags.map(named)) },
      stash: {
        key: 'stash',
        title: t('Stashes'),
        count: s.stashes.length,
        groups: plain(
          s.stashes.map((stash) => ({
            label: stash.message,
            name: stash.message,
            target: stash.id,
          })),
        ),
      },
    };
    // pull requests only for a repository on GitHub, signed in
    const pulls = !!this.repository.github() && !!this.github.account();
    return this.store
      .layout()
      .sections.filter((key) => key !== 'pull' || pulls)
      .map((key) => all[key as Kind]);
  });

  /** The sections as shown: while filtering, only what matches, unfolded. */
  protected readonly shown = computed<Section[]>(() => {
    const words = this.query().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return this.sections();
    const matches = (item: Item) => words.every((w) => item.name.toLowerCase().includes(w));
    return this.sections()
      .map((section) => {
        const groups = section.groups
          .map((group) => ({ ...group, items: group.items.filter(matches) }))
          .filter((group) => group.items.length);
        return { ...section, groups, count: groups.reduce((n, g) => n + g.items.length, 0) };
      })
      .filter((section) => section.count);
  });
  protected readonly switchHint = computed(() => t('Double-click to switch to it'));

  @HostListener('document:keydown', ['$event'])
  protected shortcut(event: KeyboardEvent) {
    if (!this.repository.active() || !event.ctrlKey || !event.altKey) return;
    if (event.key.toLowerCase() !== 'f') return;
    event.preventDefault();
    this.filter()?.nativeElement.select();
  }

  /** Open, unless folded away; everything is while filtering. */
  protected unfolded(key: string): boolean {
    return !!this.query().trim() || !this.collapsed().has(key);
  }

  protected toggle(key: string) {
    this.store.update((s) => ({
      ...s,
      collapsed: s.collapsed.includes(key)
        ? s.collapsed.filter((k) => k !== key)
        : [...s.collapsed, key],
    }));
  }

  /** How the history's view names an item (`branch:main`); stashes have none. */
  protected keyOf(kind: Kind, name: string): string | null {
    const prefix = { local: 'branch', remote: 'remote', pull: null, tag: 'tag', stash: null }[kind];
    return prefix && `${prefix}:${name}`;
  }

  protected switchTo(kind: Kind, item: Item) {
    const pull = kind === 'pull' && this.pull(item);
    if (pull) void this.repository.checkoutPull(pull);
    else if (kind === 'remote' || (kind === 'local' && item.name !== this.head())) {
      this.repository.checkout(item.name, kind === 'remote');
    }
  }

  protected entriesFor(kind: Kind, item: Item): MenuEntry[] {
    const m = this.menus;
    switch (kind) {
      case 'local':
        return m.forBranch(item.name);
      case 'remote':
        return m.forRemoteBranch(item.name);
      case 'pull': {
        const pull = this.pull(item);
        return pull ? m.forPull(pull) : [];
      }
      case 'tag':
        return m.forTag(item.name);
      case 'stash': {
        const commit = this.repository.snapshot()?.commits.find((c) => c.id === item.target);
        return commit ? m.forCommit(commit) : [];
      }
    }
  }

  /** The pull request an item of its section stands for. */
  private pull(item: Item) {
    return this.repository.pulls()?.find((p) => String(p.number) === item.name) ?? null;
  }

  protected addRemote() {
    this.menus.ask({
      title: t('A new remote'),
      fields: [
        { label: t('Name'), code: true, value: 'origin' },
        { label: t('URL'), code: true, placeholder: 'git@github.com:owner/repository.git' },
      ],
      confirm: t('Add the remote'),
      answered: ([name, url]) => this.repository.addRemote(name, url),
    });
  }

  /** A local branch dropped on another: what to do with them, at the drop. */
  protected dropBranch(event: DragEvent, onto: string) {
    event.preventDefault();
    const from = this.dragging();
    this.dragging.set(null);
    if (from && from !== onto) this.menus.open(event, this.menus.forDrop(from, onto));
  }

  /** The section dragged lands where `target` is. */
  protected dropSection(target: Kind) {
    const moved = this.moving();
    this.moving.set(null);
    if (!moved || moved === target) return;
    const order = [...this.store.layout().sections];
    const to = order.indexOf(target);
    order.splice(order.indexOf(moved), 1);
    order.splice(to, 0, moved);
    this.store.setLayout({ sections: order });
  }

  /** Drags the bottom of a section's list: it keeps the height given. */
  protected resize(event: PointerEvent, key: Kind, list: HTMLElement) {
    const start = list.getBoundingClientRect().height;
    follow(event, (_, dy) =>
      this.store.setLayout({
        heights: { ...this.store.layout().heights, [key]: Math.max(MIN_HEIGHT, start + dy) },
      }),
    );
  }

  /** The list as tall as it is again. */
  protected unsize(key: Kind) {
    const heights = { ...this.store.layout().heights };
    delete heights[key];
    this.store.setLayout({ heights });
  }
}
