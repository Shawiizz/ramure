import { Component, computed, inject, signal } from '@angular/core';
import { t } from '../../core/i18n/i18n';
import { TPipe } from '../../core/i18n/t.pipe';
import { PreferencesService } from '../../core/services/preferences.service';
import { AboutPage } from './pages/about-page';
import { EditorPage } from './pages/editor-page';
import { GeneralPage } from './pages/general-page';
import { GitPage } from './pages/git-page';
import { TerminalPage } from './pages/terminal-page';
import { ToolsPage } from './pages/tools-page';

type Page = 'general' | 'editor' | 'terminal' | 'git' | 'tools' | 'about';

/** The settings: a page per subject, every change applied and kept at once. */
@Component({
  selector: 'app-settings-dialog',
  templateUrl: './settings-dialog.html',
  styleUrl: './settings-dialog.scss',
  imports: [TPipe, GeneralPage, EditorPage, TerminalPage, GitPage, ToolsPage, AboutPage],
})
export class SettingsDialog {
  private readonly service = inject(PreferencesService);
  protected readonly page = signal<Page>('general');
  protected readonly pages = computed<{ id: Page; label: string }[]>(() => [
    { id: 'general', label: t('General') },
    { id: 'editor', label: t('Editor') },
    { id: 'terminal', label: t('Terminal') },
    { id: 'git', label: 'Git' },
    { id: 'tools', label: t('External tools') },
    { id: 'about', label: t('About') },
  ]);
  protected readonly title = computed(() => this.pages().find((p) => p.id === this.page())!.label);

  protected close() {
    this.service.open.set(false);
  }
}
