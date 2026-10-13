import { Component, inject, signal } from '@angular/core';
import { TPipe } from '../../core/i18n/t.pipe';
import { TabsService, splitPath } from '../../core/services/tabs.service';

/** The workspaces: reopen one's repositories in tabs, or keep the open tabs as a new one. */
@Component({
  selector: 'app-workspace-menu',
  template: `
    <button
      class="trigger"
      [class.open]="open()"
      (click)="open.set(!open())"
      [title]="'Repositories opened together' | t"
    >
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <rect x="2" y="2.5" width="5" height="5" rx="1" />
        <rect x="9" y="2.5" width="5" height="5" rx="1" />
        <rect x="2" y="9.5" width="5" height="5" rx="1" />
        <rect x="9" y="9.5" width="5" height="5" rx="1" />
      </svg>
      {{ 'Workspaces' | t }}
    </button>
    @if (open()) {
      <div class="backdrop" (click)="open.set(false)"></div>
      <div class="r-popover" (keydown.escape)="open.set(false)">
        @if (tabs.workspaces().length) {
          <ul>
            @for (workspace of tabs.workspaces(); track workspace.id) {
              <li>
                <button
                  class="item"
                  (click)="openWorkspace(workspace.id)"
                  [title]="names(workspace.paths)"
                >
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
    }
    .trigger {
      height: 28px;
      display: flex;
      align-items: center;
      gap: 7px;
      padding: 0 10px;
      border: 0;
      border-radius: var(--r-radius);
      background: transparent;
      color: var(--r-text-2);
      cursor: pointer;
      svg {
        width: 14px;
        height: 14px;
        fill: none;
        stroke: currentColor;
        stroke-width: 1.3;
      }
      &:hover,
      &.open {
        background: var(--r-hover);
        color: var(--r-text);
      }
    }
    .backdrop {
      position: fixed;
      inset: 0;
      z-index: 10;
    }
    .r-popover {
      top: calc(100% + 8px);
      right: 0;
      width: 300px;
    }
    ul {
      margin: 0 -6px;
      padding: 0;
      list-style: none;
    }
    li {
      display: flex;
      align-items: center;
      border-radius: 4px;
      &:hover {
        background: var(--r-hover);
      }
      &:hover .remove {
        visibility: visible;
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
      border-radius: 4px;
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
