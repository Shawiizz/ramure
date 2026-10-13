import { Component, HostListener, computed, inject, viewChild } from '@angular/core';
import { t } from '../../core/i18n/i18n';
import { TPipe } from '../../core/i18n/t.pipe';
import { RepositoryService } from '../../core/services/repository.service';
import { MenusService } from '../repository-tab/menus.service';
import { FileBlame } from './file-blame';
import { FileEditor } from './file-editor';
import { FileHistory } from './file-history';

/** One file looked at on its own, over the history: its commits, its blame, or itself edited. */
@Component({
  selector: 'app-file-panel',
  template: `
    @if (repository.filePanel(); as panel) {
      <section class="panel">
        <header class="head">
          <span class="mode">{{ mode() }}</span>
          <span class="path r-mono">{{ panel.path }}</span>
          @if (panel.at) {
            <span class="at">{{ 'In commit {id}' | t: { id: panel.at.slice(0, 7) } }}</span>
          }
          <span class="space"></span>
          @if (editor(); as editor) {
            @if (editor.dirty()) {
              <span class="unsaved">{{ 'Not saved' | t }}</span>
            }
            <button
              class="r-btn r-btn--primary small"
              [disabled]="!editor.dirty() || repository.working()"
              (click)="editor.save()"
            >
              {{ 'Save (Ctrl+S)' | t }}
            </button>
          }
          <button
            class="r-bar-btn icon"
            (click)="close()"
            [attr.aria-label]="'Back to the history (Esc)' | t"
            [title]="'Back to the history (Esc)' | t"
          >
            <svg viewBox="0 0 10 10" aria-hidden="true">
              <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" />
            </svg>
          </button>
        </header>
        <div class="body">
          @switch (panel.mode) {
            @case ('history') {
              <app-file-history [path]="panel.path" />
            }
            @case ('blame') {
              <app-file-blame [path]="panel.path" [at]="panel.at" />
            }
            @case ('edit') {
              <app-file-editor [path]="panel.path" />
            }
          }
        </div>
      </section>
    }
  `,
  styles: `
    .panel {
      height: 100%;
      display: flex;
      flex-direction: column;
      background: var(--r-void);
    }
    .head {
      flex: none;
      height: var(--r-panel-head);
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 0 6px 0 16px;
      border-bottom: 1px solid var(--r-line);
      background: var(--r-base);
      white-space: nowrap;
    }
    .mode {
      color: var(--r-text-3);
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .path {
      min-width: 0;
      overflow: hidden;
      font-size: 13px;
      text-overflow: ellipsis;
    }
    .at {
      color: var(--r-text-3);
      font-size: 12px;
    }
    .space {
      flex: 1;
    }
    .unsaved {
      color: var(--r-lane-1);
      font-size: 12px;
    }
    .small {
      height: 26px;
      padding: 0 10px;
      font-size: 12px;
    }
    .icon {
      width: 30px;
      padding: 0;
      justify-content: center;
      svg {
        width: 10px;
        height: 10px;
      }
    }
    .body {
      position: relative;
      flex: 1;
      min-height: 0;
    }
    .body > * {
      position: absolute;
      inset: 0;
    }
  `,
  imports: [TPipe, FileHistory, FileBlame, FileEditor],
})
export class FilePanel {
  protected readonly repository = inject(RepositoryService);
  private readonly menus = inject(MenusService);
  protected readonly editor = viewChild(FileEditor);

  protected readonly mode = computed(() => {
    switch (this.repository.filePanel()?.mode) {
      case 'history':
        return t('File history');
      case 'blame':
        return t('File blame');
      default:
        return t('Editing');
    }
  });

  @HostListener('document:keydown.escape', ['$event'])
  protected escape(event: Event) {
    if (event.defaultPrevented || !this.repository.active()) return;
    if ((event.target as HTMLElement).closest('.find-widget')) return;
    this.close();
  }

  /** Back to the history; edits not saved are only thrown away once sure. */
  protected close() {
    const shut = () => {
      this.repository.filePanel.set(null);
      this.repository.diff.set(null);
    };
    if (!this.editor()?.dirty()) return shut();
    this.menus.ask({
      title: t('Close without saving?'),
      text: t('The edits not saved are lost.'),
      fields: [],
      confirm: t('Close'),
      danger: true,
      answered: shut,
    });
  }
}
