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
        class="r-bar-btn trigger"
        [class.open]="open()"
        (click)="toggle()"
        [attr.aria-label]="active.name"
        [title]="
          active.name +
          '
' +
          ('Commits are signed by {name}' | t: { name: signer() })
        "
      >
        <app-avatar
          [name]="active.identity.name || active.name"
          [email]="active.identity.email"
          [size]="22"
        />
        <svg class="caret" viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4" /></svg>
      </button>
    }
    @if (open()) {
      <div class="backdrop" (click)="open.set(false)"></div>
      <div class="r-popover" [class.list]="editing() === null" (keydown.escape)="open.set(false)">
        @if (editing() === null) {
          <ul>
            @for (profile of profiles.profiles(); track profile.id) {
              <li>
                <button class="item" (click)="use(profile)">
                  <app-avatar
                    [name]="profile.identity.name || profile.name"
                    [email]="profile.identity.email"
                    [size]="28"
                  />
                  <span class="who">
                    <span class="name">{{ profile.name }}</span>
                    <span class="identity">{{ describe(profile) }}</span>
                  </span>
                  @if (profile.id === profiles.active()?.id) {
                    <svg class="check" viewBox="0 0 16 16" aria-hidden="true">
                      <path d="M3 8.5l3 3 7-7" />
                    </svg>
                  }
                </button>
                <button class="edit" (click)="edit(profile)" [title]="'Edit this profile' | t">
                  {{ 'Edit' | t }}
                </button>
              </li>
            }
          </ul>
          <button class="add" (click)="edit(null)">
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" /></svg>
            {{ 'New profile' | t }}
          </button>
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
      display: flex;
    }
    .trigger {
      height: 30px;
      gap: 5px;
      padding: 0 7px 0 4px;
    }
    .trigger .caret {
      width: 10px;
      height: 6px;
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
    .list {
      gap: 2px;
      padding: 6px 6px 0;
      overflow: hidden;
    }
    ul {
      margin: 0;
      padding: 0;
      list-style: none;
    }
    li {
      display: flex;
      align-items: center;
      border-radius: var(--r-radius);
      &:hover {
        background: var(--r-hover);
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
      flex: 1;
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
    .check {
      flex: none;
      width: 16px;
      height: 16px;
      fill: none;
      stroke: var(--r-accent);
      stroke-width: 1.8;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .add {
      height: 36px;
      display: flex;
      align-items: center;
      gap: 10px;
      margin: 4px -6px 0;
      padding: 0 14px;
      border: 0;
      border-top: 1px solid var(--r-line);
      background: transparent;
      color: var(--r-text-2);
      cursor: pointer;
      svg {
        width: 14px;
        height: 14px;
        fill: none;
        stroke: currentColor;
        stroke-width: 1.5;
        stroke-linecap: round;
      }
      &:hover {
        background: var(--r-hover);
        color: var(--r-text);
      }
    }
    .edit {
      visibility: hidden;
      height: 24px;
      margin-right: 6px;
      padding: 0 8px;
      border: 1px solid var(--r-line-strong);
      border-radius: var(--r-radius);
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
