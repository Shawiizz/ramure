import { Component, computed, inject, signal } from '@angular/core';
import { t } from '../../core/i18n/i18n';
import { TPipe } from '../../core/i18n/t.pipe';
import { Profile } from '../../core/models/settings';
import { ProfilesService } from '../../core/services/profiles.service';
import { Avatar } from '../../shared/avatar';

/** The profile in use, the others to switch to, and their identities to edit. */
@Component({
  selector: 'app-profile-menu',
  template: `
    @if (profiles.active(); as active) {
      <button
        class="trigger"
        [class.open]="open()"
        (click)="toggle()"
        [title]="'Commits are signed by {name}' | t: { name: signer() }"
      >
        <app-avatar
          [name]="active.identity.name || active.name"
          [key]="active.identity.email"
          [size]="22"
        />
        <span class="label">{{ active.name }}</span>
        <svg class="caret" viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4" /></svg>
      </button>
    }
    @if (open()) {
      <div class="backdrop" (click)="open.set(false)"></div>
      <div class="r-popover" (keydown.escape)="open.set(false)">
        @if (editing() === null) {
          <ul>
            @for (profile of profiles.profiles(); track profile.id) {
              <li [class.current]="profile.id === profiles.active()?.id">
                <button class="item" (click)="use(profile)">
                  <app-avatar
                    [name]="profile.identity.name || profile.name"
                    [key]="profile.identity.email"
                    [size]="28"
                  />
                  <span class="who">
                    <span class="name">{{ profile.name }}</span>
                    <span class="identity">{{ describe(profile) }}</span>
                  </span>
                </button>
                <button class="edit" (click)="edit(profile)" [title]="'Edit this profile' | t">
                  {{ 'Edit' | t }}
                </button>
              </li>
            }
          </ul>
          <button class="r-btn" (click)="edit(null)">{{ 'New profile' | t }}</button>
        } @else {
          <form (submit)="$event.preventDefault(); save()">
            <h3>{{ editing() === 'new' ? ('New profile' | t) : ('Edit the profile' | t) }}</h3>
            <label class="r-field">
              <span>{{ 'Profile name' | t }}</span>
              <input
                [value]="label()"
                (input)="label.set($any($event.target).value)"
                [placeholder]="'Work, personal…' | t"
                spellcheck="false"
              />
            </label>
            <label class="r-field">
              <span>{{ 'Author name' | t }}</span>
              <input
                [value]="name()"
                (input)="name.set($any($event.target).value)"
                spellcheck="false"
              />
            </label>
            <label class="r-field">
              <span>{{ 'Author email' | t }}</span>
              <input
                type="email"
                [value]="email()"
                (input)="email.set($any($event.target).value)"
                spellcheck="false"
              />
            </label>
            <p class="hint">
              {{ 'Ramure signs the commits it makes with this name and email.' | t }}
            </p>
            <div class="actions">
              @if (editing() !== 'new' && profiles.profiles().length > 1) {
                <button class="r-btn r-btn--ghost danger" type="button" (click)="remove()">
                  {{ 'Delete' | t }}
                </button>
              }
              <span class="space"></span>
              <button class="r-btn r-btn--ghost" type="button" (click)="editing.set(null)">
                {{ 'Cancel' | t }}
              </button>
              <button class="r-btn r-btn--primary" type="submit" [disabled]="!complete()">
                {{ 'Save' | t }}
              </button>
            </div>
          </form>
        }
      </div>
    }
  `,
  styles: `
    :host {
      position: relative;
    }
    .trigger {
      height: 30px;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 0 8px 0 4px;
      border: 0;
      border-radius: 15px;
      background: transparent;
      color: var(--r-text-2);
      cursor: pointer;
      &:hover,
      &.open {
        background: var(--r-hover);
        color: var(--r-text);
      }
    }
    .label {
      max-width: 160px;
      overflow: hidden;
      font-weight: 500;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .caret {
      width: 10px;
      height: 6px;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.4;
    }
    .backdrop {
      position: fixed;
      inset: 0;
      z-index: 10;
    }
    .r-popover {
      top: calc(100% + 8px);
      right: 0;
      width: 320px;
    }
    ul {
      margin: 0 -6px;
      padding: 0;
      list-style: none;
    }
    li {
      display: flex;
      align-items: center;
      border-radius: 6px;
      &:hover {
        background: var(--r-hover);
      }
      &.current {
        background: var(--r-hover);
        box-shadow: inset 2px 0 var(--r-accent);
      }
      &:hover .edit {
        visibility: visible;
      }
    }
    .item {
      flex: 1;
      min-width: 0;
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px;
      border: 0;
      background: transparent;
      text-align: left;
      cursor: pointer;
    }
    .who {
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 1px;
    }
    .name,
    .identity {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .name {
      font-weight: 500;
    }
    .identity {
      color: var(--r-text-3);
      font-size: 12px;
    }
    .edit {
      visibility: hidden;
      height: 24px;
      margin-right: 6px;
      padding: 0 8px;
      border: 1px solid var(--r-line-strong);
      border-radius: 4px;
      background: var(--r-raised);
      font-size: 12px;
      cursor: pointer;
      &:hover {
        border-color: var(--r-accent);
      }
    }
    form {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    h3 {
      margin: 0;
      font-size: 14px;
      font-weight: 600;
    }
    .hint {
      margin: 0;
      color: var(--r-text-3);
      font-size: 12px;
    }
    .actions {
      display: flex;
      gap: 6px;
    }
    .space {
      flex: 1;
    }
    .danger {
      color: var(--r-danger);
    }
  `,
  imports: [TPipe, Avatar],
})
export class ProfileMenu {
  protected readonly profiles = inject(ProfilesService);
  protected readonly open = signal(false);
  /** The profile being edited, `'new'` for a new one, null for the list. */
  protected readonly editing = signal<string | null>(null);
  protected readonly label = signal('');
  protected readonly name = signal('');
  protected readonly email = signal('');
  protected readonly complete = computed(
    () => !!this.label().trim() && !!this.name().trim() && this.email().includes('@'),
  );
  protected readonly signer = computed(() => {
    const identity = this.profiles.identity();
    return identity ? `${identity.name} <${identity.email}>` : t('the identity git is set up with');
  });

  protected toggle() {
    this.open.set(!this.open());
    this.editing.set(null);
  }

  protected use(profile: Profile) {
    this.profiles.use(profile.id);
    this.open.set(false);
  }

  protected edit(profile: Profile | null) {
    this.editing.set(profile?.id ?? 'new');
    this.label.set(profile?.name ?? '');
    this.name.set(profile?.identity.name ?? '');
    this.email.set(profile?.identity.email ?? '');
  }

  protected save() {
    const identity = { name: this.name().trim(), email: this.email().trim() };
    const id = this.editing();
    if (id === 'new') this.profiles.add(this.label().trim(), identity);
    else if (id) this.profiles.edit(id, this.label().trim(), identity);
    this.editing.set(null);
  }

  protected remove() {
    const id = this.editing();
    if (id && id !== 'new') this.profiles.remove(id);
    this.editing.set(null);
  }

  protected describe(profile: Profile): string {
    const { name, email } = profile.identity;
    return name || email ? `${name} <${email}>` : '';
  }
}
