import {
  Component,
  DestroyRef,
  HostListener,
  computed,
  effect,
  inject,
  input,
  untracked,
} from '@angular/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { PreferencesService } from '../../core/services/preferences.service';
import { RepositoryService } from '../../core/services/repository.service';
import { AskDialog } from '../../shared/ask-dialog';
import { ContextMenu } from '../../shared/context-menu';
import { Tab, TabsService, splitPath } from '../../core/services/tabs.service';
import { Toast } from '../../shell/toast/toast';
import { Details } from '../details/details';
import { DiffView } from '../diff/diff-view';
import { FilePanel } from '../file/file-panel';
import { TerminalPanel } from '../terminal/terminal-panel';
import { MIN_TERMINAL } from '../../core/models/settings';
import { History } from '../history/history';
import { OperationBanner } from '../operation/operation-banner';
import { RebaseDialog } from '../rebase/rebase-dialog';
import { Palette } from '../palette/palette';
import { Reflog } from '../reflog/reflog';
import { RewriteDialog } from '../rewrite/rewrite-dialog';
import { Sidebar } from '../sidebar/sidebar';
import { StatusBar } from '../status-bar/status-bar';
import { Toolbar } from '../toolbar/toolbar';
import { Welcome } from '../welcome/welcome';
import { MenusService } from './menus.service';
import { SettingsService } from '../../core/services/settings.service';
import { TPipe } from '../../core/i18n/t.pipe';
import { follow } from '../../shared/drag';

/** One tab: its repository with everything shown of it, or the welcome page. */
@Component({
  selector: 'app-repository-tab',
  template: `
    @if (repository.snapshot()) {
      <app-toolbar />
      <!-- git at work: a bar sliding under the toolbar, once it lasts -->
      <div
        class="progress"
        [class.on]="repository.working() || repository.loading() || repository.exchange()"
        role="progressbar"
      ></div>
      <app-operation-banner />
      <div class="workspace" [style.grid-template-columns]="columns()">
        <app-sidebar />
        <div
          class="splitter"
          (pointerdown)="resize($event, 'sidebar')"
          [title]="'Drag to resize' | t"
        ></div>
        <!-- the history stays beneath a diff or a file: closing them shows it back at once -->
        <div class="center">
          <div class="main">
            <app-history />
            @if (repository.filePanel()) {
              <app-file-panel />
            } @else if (repository.reflogOpen()) {
              <app-reflog />
            } @else if (repository.diff()) {
              <app-diff-view />
            }
          </div>
          <!-- out of sight, the terminal keeps its shell -->
          @if (repository.terminalOpen()) {
            <div
              class="splitter row"
              [class.gone]="!repository.terminalShown()"
              (pointerdown)="resizeTerminal($event)"
              [title]="'Drag to resize' | t"
            ></div>
            <!-- xterm.js loads the first time a terminal opens -->
            @defer {
              <app-terminal-panel
                [class.gone]="!repository.terminalShown()"
                [style.height.px]="store.layout().terminal"
              />
            }
          }
        </div>
        <div
          class="splitter"
          (pointerdown)="resize($event, 'details')"
          [title]="'Drag to resize' | t"
        ></div>
        <app-details />
      </div>
    } @else if (repository.loading()) {
      <div class="opening" role="status">
        <span class="spinner"></span>
        {{ 'Opening {name}…' | t: { name: opening() } }}
      </div>
    } @else {
      <app-welcome (chose)="show($event)" />
    }
    <app-status-bar />
    <app-toast />
    <app-palette />
    @if (menus.menu(); as menu) {
      <app-context-menu
        [entries]="menu.entries"
        [x]="menu.x"
        [y]="menu.y"
        (closed)="menus.menu.set(null)"
      />
    }
    @if (menus.asking(); as asking) {
      <app-ask-dialog [ask]="asking" (cancelled)="menus.asking.set(null)" />
    }
    @if (menus.rebasing(); as rebasing) {
      <app-rebase-dialog [rebasing]="rebasing" (closed)="menus.rebasing.set(null)" />
    }
    @if (menus.rewriting(); as commit) {
      <app-rewrite-dialog [commit]="commit" (closed)="menus.rewriting.set(null)" />
    }
  `,
  styles: `
    :host {
      height: 100%;
      display: flex;
      flex-direction: column;
    }
    :host(.behind) {
      display: none;
    }
    app-welcome {
      flex: 1;
      min-height: 0;
    }
    /* the bar under the toolbar: unseen for what is quick, sliding for what takes a while */
    .progress {
      position: relative;
      height: 2px;
      margin-bottom: -2px;
      z-index: 3;
      overflow: hidden;
      opacity: 0;
      &::after {
        content: '';
        position: absolute;
        inset: 0 auto 0 0;
        width: 30%;
        background: var(--r-accent);
        animation: slide 1.1s ease-in-out infinite;
      }
      &.on {
        opacity: 1;
        transition: opacity var(--r-fast) 250ms;
      }
    }
    @keyframes slide {
      from {
        transform: translateX(-100%);
      }
      to {
        transform: translateX(340%);
      }
    }
    .opening {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 14px;
      color: var(--r-text-2);
    }
    .spinner {
      width: 26px;
      height: 26px;
      border: 2.5px solid var(--r-line-strong);
      border-top-color: var(--r-accent);
      border-radius: 50%;
      animation: turn 0.8s linear infinite;
    }
    @keyframes turn {
      to {
        transform: rotate(360deg);
      }
    }
    .center {
      min-width: 0;
      min-height: 0;
      display: flex;
      flex-direction: column;
    }
    .main {
      position: relative;
      flex: 1;
      min-height: 0;
    }
    app-terminal-panel {
      flex: none;
      max-height: 80%;
    }
    /* hidden, its host's own display set aside */
    app-terminal-panel.gone,
    .splitter.gone {
      display: none;
    }
    app-history {
      display: block;
      height: 100%;
    }
    app-diff-view,
    app-file-panel,
    app-reflog {
      position: absolute;
      inset: 0;
      background: var(--r-void);
    }
    .workspace {
      flex: 1;
      min-height: 0;
      display: grid;
      /* the panels take the window's height, whatever their lists hold */
      grid-template-rows: minmax(0, 1fr);
    }
    /* no room of its own: a grip over the border between two panels */
    .splitter {
      position: relative;
      z-index: 2;
      cursor: col-resize;
      &::before {
        content: '';
        position: absolute;
        inset: 0 -3px;
      }
      &:hover::before {
        background: color-mix(in srgb, var(--r-accent) 50%, transparent);
        inset: 0 -1px;
      }
      /* between the history and the terminal, dragged up and down */
      &.row {
        height: 0;
        cursor: row-resize;
        &::before {
          inset: -3px 0;
        }
        &:hover::before {
          inset: -1px 0;
        }
      }
    }
  `,
  providers: [RepositoryService, MenusService],
  host: { '[class.behind]': '!active()' },
  imports: [
    TPipe,
    Toolbar,
    OperationBanner,
    Sidebar,
    History,
    DiffView,
    FilePanel,
    TerminalPanel,
    Details,
    Welcome,
    StatusBar,
    Toast,
    ContextMenu,
    AskDialog,
    RebaseDialog,
    RewriteDialog,
    Palette,
    Reflog,
  ],
})
export class RepositoryTab {
  readonly tab = input.required<Tab>();
  /** The repository being opened, by its folder's name. */
  protected readonly opening = computed(() => splitPath(this.tab().path ?? '').name);
  readonly active = input(false);
  protected readonly repository = inject(RepositoryService);
  protected readonly menus = inject(MenusService);
  protected readonly store = inject(SettingsService);
  protected readonly columns = computed(() => {
    const { sidebar, details } = this.store.layout();
    return `${sidebar}px 0 minmax(0, 1fr) 0 ${details}px`;
  });
  private readonly tabs = inject(TabsService);
  private readonly path = computed(() => this.tab().path);

  constructor() {
    effect(() => this.repository.active.set(this.active()));
    effect(() => {
      const path = this.path();
      untracked(() => this.load(path));
    });
    // back in front, or back from an editor or a terminal: the repository may have changed
    effect(() => {
      if (this.active()) untracked(() => this.repository.refresh());
    });
    const preferences = inject(PreferencesService);
    // the settings' timer fetches the remotes, the tab in front or not
    effect((onCleanup) => {
      const minutes = preferences.preferences().autoFetchMinutes;
      if (!minutes) return;
      const timer = setInterval(() => this.repository.fetchQuietly(), minutes * 60_000);
      onCleanup(() => clearInterval(timer));
    });
    // a longer or shorter history once the settings change it (nothing to read at first)
    effect(() => {
      preferences.preferences().historyLimit;
      untracked(() => this.repository.refresh());
    });
    const unlisten = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (focused && this.active()) this.repository.refresh();
    });
    inject(DestroyRef).onDestroy(() => unlisten.then((stop) => stop()));
  }

  /** Ctrl+Z undoes, Ctrl+Y or Ctrl+Shift+Z redoes; text being typed keeps them for itself. */
  @HostListener('document:keydown', ['$event'])
  protected history(event: KeyboardEvent) {
    if (!this.active() || !event.ctrlKey || event.altKey) return;
    // the key left of 1, whatever the layout writes on it: Ctrl+` or Ctrl+²
    if (event.code === 'Backquote') {
      event.preventDefault();
      return this.repository.toggleTerminal();
    }
    const target = event.target as HTMLElement;
    if (target.closest('input, textarea, select, .monaco-editor')) return;
    const key = event.key.toLowerCase();
    if (key === 'z' && !event.shiftKey) void this.repository.undo();
    else if (key === 'y' || (key === 'z' && event.shiftKey)) void this.repository.redo();
    else return;
    event.preventDefault();
  }

  /** Drags the border of the sidebar or of the details panel: the width is kept. */
  /** Drags the terminal's top edge: the height is kept. */
  protected resizeTerminal(event: PointerEvent) {
    const start = this.store.layout().terminal;
    follow(event, (_, dy) =>
      this.store.setLayout({ terminal: Math.round(Math.max(MIN_TERMINAL, start - dy)) }),
    );
  }

  protected resize(event: PointerEvent, panel: 'sidebar' | 'details') {
    const start = this.store.layout()[panel];
    const [min, max] = panel === 'sidebar' ? [160, 520] : [260, 720];
    follow(event, (dx) => {
      const width = start + (panel === 'sidebar' ? dx : -dx);
      this.store.setLayout({ [panel]: Math.round(Math.min(max, Math.max(min, width))) });
    });
  }

  protected show(path: string) {
    this.tabs.show(this.tab().id, path);
  }

  /**
   * Opens what the tab names, under the repository's own path (a folder inside it names
   * it too); a folder outside any repository brings the welcome page back, saying why.
   */
  private async load(path: string | null) {
    if (!path) {
      this.repository.close();
      return;
    }
    if (path === this.repository.snapshot()?.path) return;
    if (!(await this.repository.open(path))) {
      this.tabs.show(this.tab().id, null);
      return;
    }
    const root = this.repository.snapshot()!.path;
    this.tabs.remember(root);
    if (root !== path) this.tabs.show(this.tab().id, root);
  }
}
