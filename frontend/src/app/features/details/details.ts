import { Component, computed, inject, signal } from '@angular/core';
import { TPipe } from '../../core/i18n/t.pipe';
import { RepositoryService } from '../../core/services/repository.service';
import { fullDate } from '../../shared/when';

/** The selected commit: its message, author, date, id and parents. */
@Component({
  selector: 'app-details',
  templateUrl: './details.html',
  styleUrl: './details.scss',
  imports: [TPipe],
})
export class Details {
  protected readonly repository = inject(RepositoryService);
  protected readonly fullDate = fullDate;
  protected readonly copied = signal(false);
  protected readonly labels = computed(() => {
    const commit = this.repository.selected();
    return commit ? (this.repository.labels().get(commit.id) ?? []) : [];
  });

  async copy(id: string) {
    await navigator.clipboard.writeText(id);
    this.copied.set(true);
    setTimeout(() => this.copied.set(false), 1500);
  }
}
