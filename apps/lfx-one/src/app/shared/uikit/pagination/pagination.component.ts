// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterNextRender, ChangeDetectionStrategy, Component, computed, ElementRef, inject, Injector, input, model, Signal } from '@angular/core';
import { UI_PAGINATION_WINDOW } from '@lfx-one/shared/constants';
import { UiPaginationPage } from '@lfx-one/shared/interfaces';

import { UiButtonComponent } from '../button/button.component';

/**
 * Numbered pager for a table or list: previous, a window of five page numbers centred on the current page, next, and a
 * "Showing 1 to 10 of 42" line. Hidden when every row fits on one page. The caller slices its own rows by `page` and resets
 * `page` to 0 when a search or filter changes; an out-of-range `page` only shows as the last page, it is not written back. Place it 12px below the table, outside any horizontal scroll.
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
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly injector = inject(Injector);

  /** Rows per page. */
  public readonly pageSize = input<number>(10);
  /** Number of rows across every page. */
  public readonly total = input.required<number>();

  /** Zero-based current page. Supports two-way binding with `[(page)]`. */
  public readonly page = model<number>(0);

  protected readonly pageCount: Signal<number> = this.initPageCount();
  /** `page` kept inside the page range, so a shrinking total never shows a page that no longer exists. */
  protected readonly current: Signal<number> = this.initCurrent();
  protected readonly isFirst: Signal<boolean> = computed(() => this.current() === 0);
  protected readonly isLast: Signal<boolean> = computed(() => this.current() >= this.pageCount() - 1);
  protected readonly pages: Signal<UiPaginationPage[]> = this.initPages();
  protected readonly info: Signal<string> = this.initInfo();

  // Compared with the raw page, so the page shown as current still applies when `page` is out of range.
  protected goTo(index: number): void {
    if (index < 0 || index >= this.pageCount() || index === this.page()) return;
    this.page.set(index);
  }

  /** Previous or next. An arrow that disables itself at the end of the range would drop focus to the page, so focus moves to the current page. */
  protected step(delta: number): void {
    this.goTo(this.current() + delta);
    if (!this.isFirst() && !this.isLast()) return;
    afterNextRender(() => this.host.querySelector<HTMLButtonElement>('button[aria-current="page"]')?.focus(), { injector: this.injector });
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
      const start = Math.max(0, Math.min(current - Math.floor(UI_PAGINATION_WINDOW / 2), count - UI_PAGINATION_WINDOW));
      return Array.from({ length: Math.min(UI_PAGINATION_WINDOW, count) }, (_, offset): UiPaginationPage => {
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
