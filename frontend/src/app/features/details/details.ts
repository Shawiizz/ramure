import { Component, computed, effect, inject, signal } from '@angular/core';
import { TPipe } from '../../core/i18n/t.pipe';
import { ChangeKind, Stash } from '../../core/models/repository';
import { RepositoryService, WIP } from '../../core/services/repository.service';
import { Avatar } from '../../shared/avatar';
import { splitCoAuthors } from '../../shared/co-authors';
import { FileList, KIND } from '../../shared/file-list';
import { fullDate, shortDate } from '../../shared/when';
import { Staging } from '../staging/staging';

/** The right panel: the selected commit and its files, or the working tree to commit. */
@Component({
  selector: 'app-details',
  templateUrl: './details.html',
  styleUrl: './details.scss',
  imports: [TPipe, FileList, Staging, Avatar],
})
export class Details {
  protected readonly repository = inject(RepositoryService);
  protected readonly wip = WIP;
  protected readonly fullDate = fullDate;
  protected readonly shortDate = shortDate;
  protected readonly copied = signal(false);
  /** Deleting the stash waits for a second click. */
  protected readonly dropping = signal(false);
  /** The description, its `Co-authored-by:` lines taken out and shown as people. */
  protected readonly message = computed(() =>
    splitCoAuthors(this.repository.selected()?.body ?? ''),
  );
  /** Who wrote the commit, one per line: the author, then the co-authors. */
  protected readonly everyone = computed(() => {
    const commit = this.repository.selected();
    if (!commit) return '';
    return [commit, ...this.message().coAuthors.map((c) => ({ author: c.name, email: c.email }))]
      .map((p) => `${p.author} <${p.email}>`)
      .join('\n');
  });
  /** The selected commit's files, once read. */
  protected readonly files = computed(() => {
    const loaded = this.repository.commitFiles();
    return loaded && loaded.id === this.repository.selectedId() ? loaded.files : null;
  });
  /** How many files of each kind, in the order of the list's letters. */
  protected readonly kinds = computed(() => {
    const counts = new Map<ChangeKind, number>();
    for (const file of this.files() ?? []) counts.set(file.kind, (counts.get(file.kind) ?? 0) + 1);
    return (Object.keys(KIND) as ChangeKind[])
      .filter((kind) => counts.has(kind))
      .map((kind) => ({ ...KIND[kind], count: counts.get(kind)! }));
  });
  protected readonly openPath = computed(() => {
    const diff = this.repository.diff();
    const where = diff?.where;
    return (where?.kind === 'commit' || where?.kind === 'stash') &&
      where.id === this.repository.selectedId()
      ? diff!.change.path
      : null;
  });

  constructor() {
    // another selection: the second click asked for no longer applies
    effect(() => {
      this.repository.selectedId();
      this.dropping.set(false);
    });
  }

  protected stashName(stash: Stash): string {
    return `stash@{${stash.index}}`;
  }

  protected async drop(stash: Stash) {
    this.dropping.set(false);
    await this.repository.dropStash(stash);
  }

  protected async copy(id: string) {
    await navigator.clipboard.writeText(id);
    this.copied.set(true);
    setTimeout(() => this.copied.set(false), 1500);
  }
}
