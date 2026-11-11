// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, input, model, Signal } from '@angular/core';
import { UiPaginationPage } from '@lfx-one/shared/interfaces';

import { UiButtonComponent } from '../button/button.component';

/** Pages shown at once; the window stays centred on the current page where it can. */
const PAGE_WINDOW = 5;

/**
 * Numbered pager for a table or list: previous, a window of five page numbers centred on the current page, next, and a
 * "Showing 1 to 10 of 42" line. Hidden when every row fits on one page. The caller slices its own rows by `page` and resets
 * `page` to 0 when a search or filter changes. Place it 12px below the table, outside any horizontal scroll.
 */
@Component({
  selector: 'lfx-ui-pagination',
  imports: [UiButtonComponent],
  templateUrl: './pagination.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block',
    'data-testid': 'ui-pagination',
  },
})
export class UiPaginationComponent {
  /** Zero-based current page. Supports two-way binding with `[(page)]`. */
  public readonly page = model<number>(0);
  /** Rows per page. */
  public readonly pageSize = input<number>(10);
  /** Number of rows across every page. */
  public readonly total = input.required<number>();

  protected readonly pageCount: Signal<number> = this.initPageCount();
  /** `page` kept inside the page range, so a shrinking total never shows a page that no longer exists. */
  protected readonly current: Signal<number> = this.initCurrent();
  protected readonly isFirst: Signal<boolean> = computed(() => this.current() === 0);
  protected readonly isLast: Signal<boolean> = computed(() => this.current() >= this.pageCount() - 1);
  protected readonly pages: Signal<UiPaginationPage[]> = this.initPages();
  protected readonly info: Signal<string> = this.initInfo();

  protected goTo(index: number): void {
    if (index < 0 || index >= this.pageCount() || index === this.current()) return;
    this.page.set(index);
  }

  private initPageCount(): Signal<number> {
    return computed(() => {
      const size = this.pageSize();
      return size > 0 ? Math.ceil(Math.max(0, this.total()) / size) : 0;
    });
  }

  private initCurrent(): Signal<number> {
    return computed(() => Math.min(Math.max(0, Math.trunc(this.page())), Math.max(0, this.pageCount() - 1)));
  }

  private initPages(): Signal<UiPaginationPage[]> {
    return computed(() => {
      const count = this.pageCount();
      const current = this.current();
      const start = Math.max(0, Math.min(current - Math.floor(PAGE_WINDOW / 2), count - PAGE_WINDOW));
      return Array.from({ length: Math.min(PAGE_WINDOW, count) }, (_, offset): UiPaginationPage => {
        const index = start + offset;
        const isCurrent = index === current;
        const label = String(index + 1);
        return { index, label, ariaLabel: `Page ${label}`, variant: isCurrent ? 'secondary' : 'tertiary', ariaCurrent: isCurrent ? 'page' : null };
      });
    });
  }

  private initInfo(): Signal<string> {
    return computed(() => {
      // A fixed locale keeps the server and client render identical.
      const format = (value: number) => value.toLocaleString('en-US');
      const total = Math.max(0, this.total());
      const first = this.current() * this.pageSize() + 1;
      const last = Math.min(total, (this.current() + 1) * this.pageSize());
      return `Showing ${format(first)} to ${format(last)} of ${format(total)}`;
    });
  }
}
