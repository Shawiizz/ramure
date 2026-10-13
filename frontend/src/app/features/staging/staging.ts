import { Component, computed, inject } from '@angular/core';
import { t } from '../../core/i18n/i18n';
import { TPipe } from '../../core/i18n/t.pipe';
import { Change } from '../../core/models/repository';
import { RepositoryService } from '../../core/services/repository.service';
import { PreferencesService } from '../../core/services/preferences.service';
import { FileList } from '../../shared/file-list';
import { TreeSwitch } from '../../shared/tree-switch';
import { MenusService } from '../repository-tab/menus.service';

/** The working tree's changes: stage them, unstage them, commit what is staged. */
@Component({
  selector: 'app-staging',
  templateUrl: './staging.html',
  styleUrl: './staging.scss',
  imports: [TPipe, FileList, TreeSwitch],
})
export class Staging {
  protected readonly repository = inject(RepositoryService);
  protected readonly menus = inject(MenusService);
  private readonly preferences = inject(PreferencesService);
  protected readonly tree = computed(() => this.preferences.preferences().fileTree);
  protected readonly branch = computed(() => {
    const head = this.repository.snapshot()?.head;
    return head?.kind === 'branch' ? head.name : null;
  });
  protected readonly stageLabel = computed(() => t('Stage'));
  protected readonly unstageLabel = computed(() => t('Unstage'));

  protected readonly status = computed(() => this.repository.snapshot()?.status);
  protected readonly openPath = computed(() => {
    const diff = this.repository.diff();
    const kind = diff?.where.kind;
    return kind === 'staged' || kind === 'unstaged' ? diff!.change.path : null;
  });
  protected readonly canCommit = computed(
    () =>
      !!this.status()?.staged.length &&
      !!this.repository.summary().trim() &&
      !this.repository.working(),
  );

  protected show(change: Change, staged: boolean) {
    this.repository.toggleDiff(change, { kind: staged ? 'staged' : 'unstaged' });
  }

  protected paths(changes: Change[]): string[] {
    return changes.map((c) => c.path);
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
}
