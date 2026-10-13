import { Component, computed, inject, signal } from '@angular/core';
import { TPipe } from '../../core/i18n/t.pipe';
import { RepositoryService, WIP } from '../../core/services/repository.service';
import { FileList } from '../../shared/file-list';
import { fullDate } from '../../shared/when';
import { Staging } from '../staging/staging';

/** The right panel: the selected commit and its files, or the working tree to commit. */
@Component({
  selector: 'app-details',
  templateUrl: './details.html',
  styleUrl: './details.scss',
  imports: [TPipe, FileList, Staging],
})
export class Details {
  protected readonly repository = inject(RepositoryService);
  protected readonly wip = WIP;
  protected readonly fullDate = fullDate;
  protected readonly copied = signal(false);
  protected readonly labels = computed(() => {
    const commit = this.repository.selected();
    return commit ? (this.repository.labels().get(commit.id) ?? []) : [];
  });
  /** The selected commit's files, once read. */
  protected readonly files = computed(() => {
    const loaded = this.repository.commitFiles();
    return loaded && loaded.id === this.repository.selectedId() ? loaded.files : null;
  });
  protected readonly openPath = computed(() => {
    const diff = this.repository.diff();
    return diff?.where.kind === 'commit' ? diff.change.path : null;
  });

  async copy(id: string) {
    await navigator.clipboard.writeText(id);
    this.copied.set(true);
    setTimeout(() => this.copied.set(false), 1500);
  }
}
