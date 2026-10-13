import { Directive, computed, inject, signal } from '@angular/core';
import { open } from '@tauri-apps/plugin-dialog';
import { t } from '../../core/i18n/i18n';
import { NewRepositoryService } from '../../core/services/new-repository.service';
import { PreferencesService } from '../../core/services/preferences.service';

/**
 * What the dialogs making a repository share: the folder it goes in, offered as the last
 * one used; its own folder's name; the work under way and why it failed.
 */
@Directive()
export abstract class MakingDialog {
  protected readonly service = inject(NewRepositoryService);
  private readonly preferences = inject(PreferencesService);
  protected readonly parent = signal(this.preferences.preferences().cloneFolder);
  protected readonly name = signal('');
  protected readonly busy = signal(false);
  protected readonly failure = signal<string | null>(null);
  /** Where the repository will be. */
  protected readonly where = computed(() => {
    const parent = this.parent().replace(/[\\/]+$/, '');
    const sep = parent.includes('\\') ? '\\' : '/';
    return parent && this.name().trim() ? `${parent}${sep}${this.name().trim()}` : '';
  });

  protected async browse() {
    const folder = await open({ directory: true, title: t('The folder it goes in') });
    if (typeof folder === 'string') this.parent.set(folder);
  }

  protected close() {
    if (!this.busy()) this.service.making.set(null);
  }

  /** Runs the making; the repository made shows, the folder is offered next time. */
  protected async make(act: () => Promise<string>) {
    this.busy.set(true);
    this.failure.set(null);
    try {
      const path = await act();
      this.preferences.set('cloneFolder', this.parent());
      this.service.made(path);
    } catch (e) {
      this.failure.set(String(e));
    } finally {
      this.busy.set(false);
    }
  }
}
