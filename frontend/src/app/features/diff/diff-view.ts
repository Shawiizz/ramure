import { Component, HostListener, computed, inject } from '@angular/core';
import { t } from '../../core/i18n/i18n';
import { TPipe } from '../../core/i18n/t.pipe';
import { RepositoryService } from '../../core/services/repository.service';

/** A file's changes, in the middle of the window: hunks of numbered lines. */
@Component({
  selector: 'app-diff-view',
  templateUrl: './diff-view.html',
  styleUrl: './diff-view.scss',
  imports: [TPipe],
})
export class DiffView {
  protected readonly repository = inject(RepositoryService);
  protected readonly open = this.repository.diff;
  protected readonly where = computed(() => {
    const where = this.open()?.where;
    if (!where) return '';
    if (where.kind === 'commit') return t('In commit {id}', { id: where.id.slice(0, 7) });
    return where.kind === 'staged' ? t('Staged') : t('Unstaged');
  });
  protected readonly counts = computed(() => {
    let added = 0;
    let removed = 0;
    for (const hunk of this.open()?.diff?.hunks ?? []) {
      for (const line of hunk.lines) {
        if (line.kind === 'added') added++;
        else if (line.kind === 'removed') removed++;
      }
    }
    return { added, removed };
  });

  @HostListener('document:keydown.escape')
  close() {
    this.repository.diff.set(null);
  }
}
