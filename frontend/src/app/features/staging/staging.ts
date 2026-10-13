import { Component, computed, inject, signal } from '@angular/core';
import { t } from '../../core/i18n/i18n';
import { TPipe } from '../../core/i18n/t.pipe';
import { Change } from '../../core/models/repository';
import { RepositoryService } from '../../core/services/repository.service';
import { FileList } from '../../shared/file-list';

/** The working tree's changes: stage them, unstage them, commit what is staged. */
@Component({
  selector: 'app-staging',
  templateUrl: './staging.html',
  styleUrl: './staging.scss',
  imports: [TPipe, FileList],
})
export class Staging {
  protected readonly repository = inject(RepositoryService);
  protected readonly summary = signal('');
  protected readonly description = signal('');
  protected readonly stageLabel = t('Stage');
  protected readonly unstageLabel = t('Unstage');

  protected readonly status = computed(() => this.repository.snapshot()?.status);
  protected readonly openPath = computed(() => {
    const diff = this.repository.diff();
    return diff && diff.where.kind !== 'commit' ? diff.change.path : null;
  });
  protected readonly canCommit = computed(
    () => !!this.status()?.staged.length && !!this.summary().trim() && !this.repository.working(),
  );

  protected show(change: Change, staged: boolean) {
    this.repository.toggleDiff(change, { kind: staged ? 'staged' : 'unstaged' });
  }

  protected stageAll() {
    const status = this.status();
    if (status)
      this.repository.stage([...status.unstaged, ...status.conflicted].map((c) => c.path));
  }

  protected unstageAll() {
    const status = this.status();
    if (status) this.repository.unstage(status.staged.map((c) => c.path));
  }

  protected async commit() {
    const description = this.description().trim();
    const message = description ? `${this.summary().trim()}\n\n${description}` : this.summary();
    if (await this.repository.commit(message)) {
      this.summary.set('');
      this.description.set('');
    }
  }
}
