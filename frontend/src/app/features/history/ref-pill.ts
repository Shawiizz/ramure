import { Component, computed, input } from '@angular/core';
import { t } from '../../core/i18n/i18n';
import { RefLabel } from '../../core/models/repository';

/**
 * A branch or a tag beside its commit, in its lane's colour: a screen for a local branch,
 * a cloud for a remote one (both when they are level), a tick for HEAD's branch.
 */
@Component({
  selector: 'app-ref-pill',
  template: `
    @if (label().head) {
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3 3 7-7" /></svg>
    }
    @if (label().kind === 'tag') {
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M2.5 2.5h5l6 6-5 5-6-6z" />
        <circle cx="5.5" cy="5.5" r="1" />
      </svg>
    }
    <span class="name">{{ label().name }}</span>
    @if (label().kind === 'branch') {
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <rect x="2" y="3" width="12" height="8" rx="1" />
        <path d="M5.5 13.5h5" />
      </svg>
    }
    @if (label().kind === 'remote' || label().synced) {
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M4.5 12.5h7a3 3 0 0 0 .4-6 4 4 0 0 0-7.7 1A2.5 2.5 0 0 0 4.5 12.5z" />
      </svg>
    }
  `,
  host: {
    '[style.--lane]': 'color()',
    '[class.head]': 'label().head',
    '[class.tag]': "label().kind === 'tag'",
    '[class.remote]': "label().kind === 'remote'",
    '[attr.title]': 'title()',
  },
  styles: `
    :host {
      max-width: 100%;
      height: 22px;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 0 7px;
      border: 1px solid color-mix(in srgb, var(--lane) 45%, transparent);
      border-radius: var(--r-radius);
      background: color-mix(in srgb, var(--lane) 20%, var(--r-base));
      color: var(--lane);
      font: 500 12px var(--r-font);
      white-space: nowrap;
      transition:
        background var(--r-fast),
        border-color var(--r-fast);
    }
    :host(:hover) {
      border-color: var(--lane);
      background: color-mix(in srgb, var(--lane) 34%, var(--r-base));
    }
    :host(.head) {
      border-color: var(--lane);
      background: var(--lane);
      color: var(--r-on-accent);
      font-weight: 600;
    }
    :host(.head:hover) {
      background: color-mix(in srgb, var(--lane) 82%, var(--r-text));
    }
    :host(.remote) {
      background: var(--r-base);
    }
    :host(.remote:hover) {
      background: color-mix(in srgb, var(--lane) 16%, var(--r-base));
    }
    :host(.tag) {
      border-color: var(--r-line-strong);
      background: var(--r-raised);
      color: var(--r-text-2);
    }
    :host(.tag:hover) {
      border-color: var(--r-text-3);
      background: var(--r-hover);
      color: var(--r-text);
    }
    .name {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    svg {
      flex: none;
      width: 12px;
      height: 12px;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.5;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
  `,
})
export class RefPill {
  readonly label = input.required<RefLabel>();
  readonly color = input.required<string>();
  protected readonly title = computed(() => {
    const { name, kind, head, synced } = this.label();
    if (kind === 'tag') return t('Tag {name}', { name });
    if (kind === 'remote') return t('Remote branch {name}: double-click to work on it', { name });
    if (head) return t('Branch {name}, checked out', { name });
    return synced
      ? t('Branch {name}, level with its remote: double-click to switch to it', { name })
      : t('Branch {name}: double-click to switch to it', { name });
  });
}
