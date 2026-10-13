import { Component, computed, effect, inject, signal } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { t } from '../../core/i18n/i18n';
import { TPipe } from '../../core/i18n/t.pipe';
import { Stash, Verification } from '../../core/models/repository';
import { DEFAULT_LAYOUT, MIN_MESSAGE } from '../../core/models/settings';
import { PreferencesService } from '../../core/services/preferences.service';
import { RepositoryService, WIP } from '../../core/services/repository.service';
import { SettingsService } from '../../core/services/settings.service';
import { Avatar } from '../../shared/avatar';
import { splitCoAuthors } from '../../shared/co-authors';
import { follow } from '../../shared/drag';
import { FileList, countKinds } from '../../shared/file-list';
import { TreeSwitch } from '../../shared/tree-switch';
import { fullDate, shortDate } from '../../shared/when';
import { MenusService } from '../repository-tab/menus.service';
import { Staging } from '../staging/staging';

/** The right panel: the selected commit and its files, or the working tree to commit. */
@Component({
  selector: 'app-details',
  templateUrl: './details.html',
  styleUrl: './details.scss',
  imports: [TPipe, FileList, Staging, Avatar, TreeSwitch],
})
export class Details {
  protected readonly repository = inject(RepositoryService);
  protected readonly menus = inject(MenusService);
  private readonly store = inject(SettingsService);
  private readonly preferences = inject(PreferencesService);
  protected readonly tree = computed(() => this.preferences.preferences().fileTree);
  protected readonly wip = WIP;
  protected readonly messageHeight = computed(() => this.store.layout().message);
  protected readonly fullDate = fullDate;
  protected readonly shortDate = shortDate;
  protected readonly copied = signal(false);
  /** Deleting the stash waits for a second click. */
  protected readonly dropping = signal(false);
  /** The description, its `Co-authored-by:` lines taken out and shown as people. */
  protected readonly message = computed(() =>
    splitCoAuthors(this.repository.selected()?.body ?? ''),
  );
  /** Who wrote the commit, one per line: the author, then the co-authors. */
  protected readonly everyone = computed(() => {
    const commit = this.repository.selected();
    if (!commit) return '';
    return [commit, ...this.message().coAuthors.map((c) => ({ author: c.name, email: c.email }))]
      .map((p) => `${p.author} <${p.email}>`)
      .join('\n');
  });
  /** The selected commit's signature, once read and when it has one. */
  protected readonly signature = computed(() => {
    const read = this.repository.signature();
    return read?.id === this.repository.selectedId() ? read.signature : null;
  });
  /** The selected commit's signature checked, once asked for: it takes gpg a while. */
  private readonly checks = signal(new Map<string, Verification | 'checking'>());
  protected readonly verification = computed(
    () => this.checks().get(this.repository.selectedId() ?? '') ?? null,
  );
  protected readonly signatureState = computed(() => {
    const checked = this.verification();
    if (!checked) return 'signed';
    if (checked === 'checking') return 'checking';
    return checked.verified ? 'verified' : 'unverified';
  });
  protected readonly stateNames = computed(() => ({
    signed: t('Signed'),
    checking: t('Checking…'),
    verified: t('Verified'),
    unverified: t('Not verified'),
  }));
  protected readonly signedTitle = computed(() => {
    const signed = this.signature();
    const checked = this.verification();
    if (!signed) return '';
    const kind = signed.kind === 'ssh' ? t('an ssh key') : t('a GPG key');
    if (!checked || checked === 'checking')
      return t('Signed with {kind}: click to check it', { kind });
    return checked.verified
      ? t('Signed with {kind}, checked: {signer}', { kind, signer: checked.signer })
      : t('Signed with {kind}, that git cannot check here', { kind });
  });
  /** The selected commit's files, once read. */
  protected readonly files = computed(() => {
    const loaded = this.repository.commitFiles();
    return loaded && loaded.id === this.repository.selectedId() ? loaded.files : null;
  });
  /** How many files of each kind, in the order of the list's letters. */
  protected readonly kinds = computed(() => countKinds(this.files() ?? []));
  protected readonly openPath = computed(() => {
    const diff = this.repository.diff();
    const where = diff?.where;
    return (where?.kind === 'commit' || where?.kind === 'stash') &&
      where.id === this.repository.selectedId()
      ? diff!.change.path
      : null;
  });

  constructor() {
    // another selection: the second click asked for no longer applies
    effect(() => {
      this.repository.selectedId();
      this.dropping.set(false);
    });
  }

  protected stashName(stash: Stash): string {
    return `stash@{${stash.index}}`;
  }

  protected async drop(stash: Stash) {
    this.dropping.set(false);
    await this.repository.dropStash(stash);
  }

  protected async copy(id: string) {
    await navigator.clipboard.writeText(id);
    this.copied.set(true);
    setTimeout(() => this.copied.set(false), 1500);
  }

  /** Drags the bottom of the message: it takes at most the height given, then scrolls. */
  protected resize(event: PointerEvent, box: HTMLElement) {
    const start = box.getBoundingClientRect().height;
    follow(event, (_, dy) =>
      this.store.setLayout({ message: Math.min(1200, Math.max(MIN_MESSAGE, start + dy)) }),
    );
  }

  protected unsize() {
    this.store.setLayout({ message: DEFAULT_LAYOUT.message });
  }

  /** Checks the commit's signature against the keys git trusts. */
  protected async verify(id: string) {
    const path = this.repository.snapshot()?.path;
    if (!path) return;
    const record = (result: Verification | 'checking') =>
      this.checks.update((checks) => new Map(checks).set(id, result));
    record('checking');
    try {
      record(await invoke<Verification>('verify_signature', { path, id }));
    } catch (e) {
      record({ verified: false, signer: String(e) });
    }
  }
}
