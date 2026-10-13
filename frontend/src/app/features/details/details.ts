import { Component, computed, inject, signal } from '@angular/core';
import { TPipe } from '../../core/i18n/t.pipe';
import { ChangeKind } from '../../core/models/repository';
import { RepositoryService, WIP } from '../../core/services/repository.service';
import { Avatar } from '../../shared/avatar';
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
    return diff?.where.kind === 'commit' && diff.where.id === this.repository.selectedId()
      ? diff.change.path
      : null;
  });

  protected async copy(id: string) {
    await navigator.clipboard.writeText(id);
    this.copied.set(true);
    setTimeout(() => this.copied.set(false), 1500);
  }
}
