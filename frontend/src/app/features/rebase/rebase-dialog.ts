import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { t } from '../../core/i18n/i18n';
import { TPipe } from '../../core/i18n/t.pipe';
import { Planned, StepAction } from '../../core/models/repository';
import { RepositoryService } from '../../core/services/repository.service';
import { Rebasing } from '../repository-tab/menus.service';

/** A commit of the plan, and what is to be done with it. */
interface Row {
  commit: Planned;
  action: StepAction;
  /** The new message, for a reword. */
  message: string;
}

/**
 * An interactive rebase, planned before it runs: the commits in the order they will be
 * replayed, newest on top (dragged to reorder), each kept, reworded, squashed or fixed up
 * into the one below it, or dropped.
 */
@Component({
  selector: 'app-rebase-dialog',
  templateUrl: './rebase-dialog.html',
  styleUrl: './rebase-dialog.scss',
  imports: [TPipe],
})
export class RebaseDialog implements OnInit {
  private readonly repository = inject(RepositoryService);
  readonly rebasing = input.required<Rebasing>();
  readonly closed = output();
  protected readonly rows = signal<Row[]>([]);
  /** The row being dragged, by index. */
  protected readonly dragged = signal<number | null>(null);
  protected readonly branch = computed(() => {
    const head = this.repository.snapshot()?.head;
    return head?.kind === 'branch' ? head.name : '';
  });
  protected readonly actions = computed<{ id: StepAction; name: string }[]>(() => [
    { id: 'pick', name: t('Keep') },
    { id: 'reword', name: t('Reword') },
    { id: 'squash', name: t('Squash into the one below') },
    { id: 'fixup', name: t('Fix up the one below') },
    { id: 'drop', name: t('Drop') },
  ]);
  /** Why the plan cannot run, if it cannot. */
  protected readonly problem = computed(() => {
    // in the order they are replayed: the oldest, at the bottom, first
    const kept = [...this.rows()].reverse().filter((r) => r.action !== 'drop');
    if (!kept.length) return t('Keep at least one commit.');
    if (kept[0].action === 'squash' || kept[0].action === 'fixup')
      return t('The oldest commit kept has nothing below to join.');
    if (kept.some((r) => r.action === 'reword' && !r.message.trim()))
      return t('A reworded commit needs a message.');
    return null;
  });

  ngOnInit() {
    // newest on top, as in the history; replayed from the bottom up
    this.rows.set(
      [...this.rebasing().plan]
        .reverse()
        .map((commit) => ({ commit, action: 'pick', message: commit.message })),
    );
  }

  protected set(index: number, change: Partial<Row>) {
    this.rows.update((rows) => rows.map((r, i) => (i === index ? { ...r, ...change } : r)));
  }

  protected drop(target: number) {
    const from = this.dragged();
    this.dragged.set(null);
    if (from === null || from === target) return;
    this.rows.update((rows) => {
      const moved = [...rows];
      const [row] = moved.splice(from, 1);
      moved.splice(target, 0, row);
      return moved;
    });
  }

  protected async start() {
    if (this.problem()) return;
    const steps = [...this.rows()].reverse().map((r) => ({
      id: r.commit.id,
      action: r.action,
      message: r.action === 'reword' ? r.message.trim() : null,
    }));
    this.closed.emit();
    await this.repository.rebaseInteractive(this.rebasing().onto, steps);
  }
}
