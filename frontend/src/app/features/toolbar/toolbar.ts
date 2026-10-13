import { Component, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { TPipe } from '../../core/i18n/t.pipe';
import { RepositoryService } from '../../core/services/repository.service';
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
  protected readonly branching = signal(false);
  protected readonly branchName = signal('');
  protected readonly upstream = computed(() => this.repository.snapshot()?.status.upstream);
  private readonly nameInput = viewChild<ElementRef<HTMLInputElement>>('name');

  constructor() {
    effect(() => this.nameInput()?.nativeElement.focus());
  }

  protected async createBranch() {
    if (await this.repository.createBranch(this.branchName().trim())) {
      this.branching.set(false);
      this.branchName.set('');
    }
  }
}
