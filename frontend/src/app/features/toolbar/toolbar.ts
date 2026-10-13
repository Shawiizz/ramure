import { Component, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { t } from '../../core/i18n/i18n';
import { TPipe } from '../../core/i18n/t.pipe';
import { PULL_MODES, PullMode } from '../../core/models/settings';
import { PreferencesService } from '../../core/services/preferences.service';
import { RepositoryService } from '../../core/services/repository.service';
import { MenusService } from '../repository-tab/menus.service';
import { BranchPicker } from './branch-picker';

/**
 * Above a repository: its name and branch (switched from here), the exchanges with its
 * remotes, a new branch, the stashes.
 */
@Component({
  selector: 'app-toolbar',
  templateUrl: './toolbar.html',
  styleUrl: './toolbar.scss',
  imports: [TPipe, BranchPicker],
})
export class Toolbar {
  protected readonly repository = inject(RepositoryService);
  private readonly menus = inject(MenusService);
  private readonly preferences = inject(PreferencesService);
  protected readonly branching = signal(false);
  protected readonly branchName = signal('');
  protected readonly upstream = computed(() => this.repository.snapshot()?.status.upstream);
  protected readonly pullLabel = computed(() => pullLabel(this.preferences.preferences().pull));
  private readonly nameInput = viewChild<ElementRef<HTMLInputElement>>('name');

  constructor() {
    effect(() => this.nameInput()?.nativeElement.focus());
  }

  /** The menu of the Pull button's caret: what the button does from then on. */
  protected choosePull(caret: HTMLElement) {
    const chosen = this.preferences.preferences().pull;
    this.menus.openUnder(
      caret,
      PULL_MODES.map((how) => ({
        label: pullLabel(how),
        checked: how === chosen,
        run: () => this.preferences.set('pull', how),
      })),
    );
  }

  protected async createBranch() {
    if (await this.repository.createBranch(this.branchName().trim())) {
      this.branching.set(false);
      this.branchName.set('');
    }
  }
}

function pullLabel(how: PullMode): string {
  switch (how) {
    case 'merge':
      return t('Pull (fast-forward if possible)');
    case 'fastForward':
      return t('Pull (fast-forward only)');
    case 'rebase':
      return t('Pull (rebase)');
  }
}
