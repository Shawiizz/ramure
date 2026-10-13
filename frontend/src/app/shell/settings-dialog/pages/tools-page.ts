import { Component, computed, signal } from '@angular/core';
import { TPipe } from '../../../core/i18n/t.pipe';
import { EDITORS } from '../../../core/models/settings';
import { SettingsPage } from '../settings-page';

/** The programs Ramure hands files and repositories to. */
@Component({
  selector: 'app-tools-page',
  template: `
    <div class="row">
      <div>
        <span class="name">{{ 'Editor' | t }}</span>
        <span class="help">{{ '“Open in…” in the menus of files and repositories.' | t }}</span>
      </div>
      <select
        class="field"
        (change)="choose($any($event.target).value)"
        [attr.aria-label]="'Editor' | t"
      >
        @for (editor of editors; track editor.command) {
          <option
            [value]="editor.command"
            [selected]="!custom() && editor.command === prefs().editor"
          >
            {{ editor.name }}
          </option>
        }
        <option value="" [selected]="custom() || !known()">
          {{ 'Another, by its command…' | t }}
        </option>
      </select>
    </div>
    @if (!known() || custom()) {
      <div class="row">
        <div>
          <span class="name">{{ 'Command' | t }}</span>
          <span class="help">{{ 'Run with the file or the folder after it.' | t }}</span>
        </div>
        <input
          class="field r-mono"
          [value]="prefs().editor"
          (change)="set('editor', $any($event.target).value.trim() || 'code')"
          spellcheck="false"
        />
      </div>
    }
  `,
  styleUrl: '../rows.scss',
  imports: [TPipe],
})
export class ToolsPage extends SettingsPage {
  protected readonly editors = EDITORS;
  protected readonly known = computed(() => EDITORS.some((e) => e.command === this.prefs().editor));
  /** Another editor asked for: its command is typed next. */
  protected readonly custom = signal(false);

  protected choose(command: string) {
    this.custom.set(!command);
    if (command) this.set('editor', command);
  }
}
