import { Component, computed, inject, signal } from '@angular/core';
import { TPipe } from '../../core/i18n/t.pipe';
import { TabsService, splitPath } from '../../core/services/tabs.service';

/**
 * The workspace in use, before the tabs it opened: switch to another (its repositories in
 * the tabs), keep the open tabs in it, or as a new one.
 */
@Component({
  selector: 'app-workspace-menu',
  template: `
    <button
      class="r-bar-btn trigger"
      [class.open]="open()"
      (click)="open.set(!open())"
      [title]="'Repositories opened together' | t"
    >
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" />
        <rect x="9" y="2.5" width="4.5" height="4.5" rx="1" />
        <rect x="2.5" y="9" width="4.5" height="4.5" rx="1" />
        <rect x="9" y="9" width="4.5" height="4.5" rx="1" />
      </svg>
      <span class="label" [class.none]="!tabs.workspace()">{{
        tabs.workspace()?.name ?? ('No workspace' | t)
      }}</span>
      <svg class="caret" viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4" /></svg>
    </button>
    @if (open()) {
      <div class="backdrop" (click)="open.set(false)"></div>
      <div class="r-popover" (keydown.escape)="open.set(false)">
        <h3>{{ 'Workspaces' | t }}</h3>
        @if (tabs.workspaces().length) {
          <ul>
            @for (workspace of tabs.workspaces(); track workspace.id) {
              @let current = workspace.id === tabs.workspace()?.id;
              <li [class.current]="current">
                <button
                  class="item"
                  (click)="openWorkspace(workspace.id)"
                  [title]="names(workspace.paths)"
                >
                  <svg class="tick" viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M3 8.5l3 3 7-7" />
                  </svg>
                  <span class="name">{{ workspace.name }}</span>
                  <span class="count">{{ workspace.paths.length }}</span>
                </button>
                <button
                  class="remove"
                  (click)="tabs.removeWorkspace(workspace.id)"
                  [attr.aria-label]="'Delete this workspace' | t"
                  [title]="'Delete this workspace' | t"
                >
                  <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2 2l6 6M8 2l-6 6" /></svg>
                </button>
              </li>
            }
          </ul>
        } @else {
          <p class="none">{{ 'Keep the open tabs as a workspace to reopen them together.' | t }}</p>
        }
        @if (changed(); as workspace) {
          <button class="r-btn" (click)="tabs.updateWorkspace(workspace.id)">
            {{ 'Keep the open tabs in {name}' | t: { name: workspace.name } }}
          </button>
        }
        <form (submit)="$event.preventDefault(); save()">
          <label class="r-field">
            <span>{{
              tabs.paths().length === 1
                ? ('Keep the open repository as' | t)
                : ('Keep the {n} open repositories as' | t: { n: tabs.paths().length })
            }}</span>
            <input
              [value]="name()"
              (input)="name.set($any($event.target).value)"
              [placeholder]="'Workspace name' | t"
              spellcheck="false"
            />
          </label>
          <button
            class="r-btn r-btn--primary"
            type="submit"
            [disabled]="!name().trim() || !tabs.paths().length"
          >
            {{ 'Save the workspace' | t }}
          </button>
        </form>
      </div>
    }
  `,
  styles: `
    :host {
      position: relative;
      display: flex;
      align-items: center;
    }
    .trigger {
      height: 28px;
      max-width: 220px;
      gap: 7px;
      padding: 0 8px;
      line-height: 1;
      svg {
        width: 14px;
        height: 14px;
      }
      .caret {
        width: 9px;
        height: 6px;
      }
    }
    .label {
      overflow: hidden;
      color: var(--r-text);
      font-weight: 500;
      text-overflow: ellipsis;
      white-space: nowrap;
      &.none {
        color: var(--r-text-3);
        font-weight: 400;
      }
    }
    .backdrop {
      position: fixed;
      inset: 0;
      z-index: 10;
    }
    .r-popover {
      top: calc(100% + 8px);
      left: 0;
      width: 300px;
      gap: 10px;
    }
    h3 {
      margin: 0;
      color: var(--r-text-3);
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    ul {
      margin: 0 -6px;
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
      &:hover .remove {
        visibility: visible;
      }
      &.current .tick {
        stroke: var(--r-accent);
      }
      &.current .name {
        font-weight: 600;
      }
    }
    .item {
      flex: 1;
      min-width: 0;
      height: 32px;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 0 8px;
      border: 0;
      background: transparent;
      text-align: left;
      cursor: pointer;
    }
    .tick {
      flex: none;
      width: 14px;
      height: 14px;
      fill: none;
      stroke: transparent;
      stroke-width: 1.8;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .name {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .count {
      color: var(--r-text-3);
      font: 500 11px var(--r-mono);
    }
    .remove {
      visibility: hidden;
      width: 24px;
      height: 24px;
      margin-right: 4px;
      display: grid;
      place-items: center;
      border: 0;
      border-radius: var(--r-radius);
      background: transparent;
      color: var(--r-text-3);
      cursor: pointer;
      svg {
        width: 9px;
        height: 9px;
        fill: none;
        stroke: currentColor;
        stroke-width: 1.3;
      }
      &:hover {
        color: var(--r-danger);
      }
    }
    .none {
      margin: 0;
      color: var(--r-text-3);
    }
    form {
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding-top: 12px;
      border-top: 1px solid var(--r-line);
    }
  `,
  imports: [TPipe],
})
export class WorkspaceMenu {
  protected readonly tabs = inject(TabsService);
  protected readonly open = signal(false);
  protected readonly name = signal('');

  /** The workspace in use, when the open tabs are no longer what it holds. */
  protected readonly changed = computed(() => {
    const workspace = this.tabs.workspace();
    const open = this.tabs.paths();
    const same =
      workspace?.paths.length === open.length && workspace.paths.every((p) => open.includes(p));
    return workspace && !same ? workspace : null;
  });

  protected openWorkspace(id: string) {
    this.tabs.openWorkspace(id);
    this.open.set(false);
  }

  protected save() {
    this.tabs.saveWorkspace(this.name().trim());
    this.name.set('');
  }

  protected names(paths: string[]): string {
    return paths.map((p) => splitPath(p).name).join(', ');
  }
}
