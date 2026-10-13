import { Component, computed, inject } from '@angular/core';
import { t } from '../../core/i18n/i18n';
import { TPipe } from '../../core/i18n/t.pipe';
import { RepositoryService } from '../../core/services/repository.service';
import { SettingsService } from '../../core/services/settings.service';

type Kind = 'local' | 'remote' | 'tag' | 'stash';

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

/**
 * The branches, remote branches (by remote), tags and stashes, each section and remote
 * folding away: a click shows their commit, a double click on a branch switches to it.
 */
@Component({
  selector: 'app-sidebar',
  templateUrl: './sidebar.html',
  styleUrl: './sidebar.scss',
  imports: [TPipe],
})
export class Sidebar {
  protected readonly repository = inject(RepositoryService);
  private readonly store = inject(SettingsService);
  protected readonly collapsed = computed(() => new Set(this.store.settings().collapsed));
  protected readonly head = computed(() => {
    const head = this.repository.snapshot()?.head;
    return head?.kind === 'branch' ? head.name : null;
  });

  protected readonly sections = computed<Section[]>(() => {
    const s = this.repository.snapshot();
    if (!s) return [];
    const plain = (items: Item[]): Group[] => [{ key: '', name: null, items }];
    const remotes = new Map<string, Item[]>();
    for (const b of s.remoteBranches) {
      const cut = b.name.indexOf('/');
      const remote = b.name.slice(0, cut);
      const item = { label: b.name.slice(cut + 1), name: b.name, target: b.target };
      remotes.set(remote, [...(remotes.get(remote) ?? []), item]);
    }
    const named = (b: { name: string; target: string }): Item => ({ label: b.name, ...b });
    return [
      {
        key: 'local',
        title: t('Branches'),
        count: s.branches.length,
        groups: plain(s.branches.map(named)),
      },
      {
        key: 'remote',
        title: t('Remote'),
        count: s.remoteBranches.length,
        groups: [...remotes].map(([name, items]) => ({ key: `remote/${name}`, name, items })),
      },
      { key: 'tag', title: t('Tags'), count: s.tags.length, groups: plain(s.tags.map(named)) },
      {
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
    ];
  });
  protected readonly switchHint = computed(() => t('Double-click to switch to it'));

  protected toggle(key: string) {
    this.store.update((s) => ({
      ...s,
      collapsed: s.collapsed.includes(key)
        ? s.collapsed.filter((k) => k !== key)
        : [...s.collapsed, key],
    }));
  }

  protected switchTo(kind: Kind, item: Item) {
    if (kind === 'remote' || (kind === 'local' && item.name !== this.head())) {
      this.repository.checkout(item.name, kind === 'remote');
    }
  }
}
