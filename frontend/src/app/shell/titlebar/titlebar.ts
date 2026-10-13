import { Component, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { TPipe } from '../../core/i18n/t.pipe';
import { RepositoryService } from '../../core/services/repository.service';

/**
 * Custom title bar: the logo, the open repository and its branch, the exchanges with the
 * remotes, a new branch, the window buttons.
 */
@Component({
  selector: 'app-titlebar',
  templateUrl: './titlebar.html',
  styleUrl: './titlebar.scss',
  imports: [TPipe],
})
export class Titlebar {
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

  async createBranch() {
    if (await this.repository.createBranch(this.branchName().trim())) {
      this.branching.set(false);
      this.branchName.set('');
    }
  }

  minimize() {
    getCurrentWindow().minimize();
  }

  toggleMaximize() {
    getCurrentWindow().toggleMaximize();
  }

  close() {
    getCurrentWindow().close();
  }
}
