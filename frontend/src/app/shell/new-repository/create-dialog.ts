import { Component, inject, signal } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { TPipe } from '../../core/i18n/t.pipe';
import { ProfilesService } from '../../core/services/profiles.service';
import { MakingDialog } from './making-dialog';

/** A new repository, in a folder of its own; started with a README when asked. */
@Component({
  selector: 'app-create-dialog',
  template: `
    <div class="backdrop" (mousedown)="close()">
      <form
        class="dialog"
        role="dialog"
        aria-modal="true"
        [attr.aria-label]="'Create a repository' | t"
        (mousedown)="$event.stopPropagation()"
        (keydown.escape)="close()"
        (submit)="$event.preventDefault(); create()"
      >
        <h2>{{ 'Create a repository' | t }}</h2>
        <label class="r-field">
          <span>{{ 'Its name' | t }}</span>
          <input
            [value]="name()"
            (input)="name.set($any($event.target).value)"
            spellcheck="false"
            [disabled]="busy()"
          />
        </label>
        <div class="r-field">
          <span>{{ 'In the folder' | t }}</span>
          <div class="folder">
            <input
              [value]="parent()"
              (input)="parent.set($any($event.target).value)"
              [disabled]="busy()"
            />
            <button class="r-btn" type="button" (click)="browse()" [disabled]="busy()">
              {{ 'Browse…' | t }}
            </button>
          </div>
        </div>
        <label class="check">
          <input
            type="checkbox"
            [checked]="readme()"
            (change)="readme.set($any($event.target).checked)"
            [disabled]="busy()"
          />
          {{ 'Start with a README, in a first commit' | t }}
        </label>
        @if (where()) {
          <p class="where">{{ where() }}</p>
        }
        <div class="actions">
          @if (failure(); as failure) {
            <span class="problem">{{ failure }}</span>
          }
          <button class="r-btn r-btn--ghost" type="button" (click)="close()" [disabled]="busy()">
            {{ 'Cancel' | t }}
          </button>
          <button class="r-btn r-btn--primary" type="submit" [disabled]="busy() || !where()">
            {{ 'Create' | t }}
          </button>
        </div>
      </form>
    </div>
  `,
  styleUrl: './dialog.scss',
  imports: [TPipe],
})
export class CreateDialog extends MakingDialog {
  private readonly profiles = inject(ProfilesService);
  protected readonly readme = signal(true);

  protected create() {
    return this.make(() =>
      invoke<string>('create_repository', {
        parent: this.parent(),
        name: this.name().trim(),
        readme: this.readme(),
        identity: this.profiles.identity(),
      }),
    );
  }
}
