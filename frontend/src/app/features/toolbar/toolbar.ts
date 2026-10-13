import { Component, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { TPipe } from '../../core/i18n/t.pipe';
import { RepositoryService } from '../../core/services/repository.service';

/** Above a repository: its name and branch, the exchanges with its remotes, a new branch. */
@Component({
  selector: 'app-toolbar',
  templateUrl: './toolbar.html',
  styleUrl: './toolbar.scss',
  imports: [TPipe],
})
export class Toolbar {
  protected readonly repository = inject(RepositoryService);
  protected readonly branching = signal(false);
  protected readonly branchName = signal('');
  protected readonly upstream = computed(() => this.repository.snapshot()?.status.upstream);
  private readonly nameInput = viewChild<ElementRef<HTMLInputElement>>('name');
  protected readonly head = computed(() => {
    const head = this.repository.snapshot()?.head;
    if (!head) return null;
    return head.kind === 'detached' ? head.id.slice(0, 7) : head.name;
  });

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
