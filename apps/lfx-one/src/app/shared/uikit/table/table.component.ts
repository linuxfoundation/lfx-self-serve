// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CdkScrollable } from '@angular/cdk/scrolling';
import { NgTemplateOutlet } from '@angular/common';
import { booleanAttribute, ChangeDetectionStrategy, Component, computed, contentChildren, input, model, output, Signal } from '@angular/core';
import { UiTableColumn, UiTableColumnView, UiTableSort } from '@lfx-one/shared/interfaces';

import { UiTableCellDirective } from './table-cell.directive';

/**
 * Rows and columns of comparable data: a 40px header, 48px rows with hairline dividers, optional footer totals.
 * Describe the columns with `columns`, pass plain objects as `rows` and put numbers pre-formatted in them. Use
 * `<ng-template lfxUiTableCell="key" let-row>` for a cell that needs markup, such as a badge or a link; clicks on
 * such inner controls do not activate an interactive row. The table does not sort or paginate: it shows the `sort`
 * it is given and reports header clicks, and the page reorders and pages `rows`.
 *
 * The root scrolls horizontally and is a focusable named region so keyboard users can reach the overflow.
 */
@Component({
  selector: 'lfx-ui-table',
  imports: [NgTemplateOutlet],
  templateUrl: './table.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // The host is the scroll container; CdkScrollable lets overlays opened from a cell follow it.
  hostDirectives: [CdkScrollable],
  host: {
    '[class]': 'hostClasses()',
    '[attr.aria-label]': 'label()',
    role: 'region',
    // shortcut: always a tab stop, even when nothing overflows. revisit: make tabindex conditional on overflow, once overflow detection is shared
    tabindex: '0',
    'data-testid': 'ui-table',
  },
})
export class UiTableComponent {
  /** Accessible name of the table, also used as its hidden caption. */
  public readonly label = input.required<string>();
  /** Column definitions, in display order. */
  public readonly columns = input.required<UiTableColumn[]>();
  /** One object per body row. Cells show `row[column.key]`; a missing value shows nothing. */
  public readonly rows = input.required<Record<string, unknown>[]>();
  /** Name of the row field that is unique per row, used to track rows between updates. */
  public readonly rowKey = input.required<string>();
  /** Footer totals row: a value per column key. Put the "Total" label under the first column's key. */
  public readonly footer = input<Record<string, unknown> | null>(null);
  /** Draws the hairline ring and 12px radius around the table. */
  public readonly bordered = input<boolean, unknown>(false, { transform: booleanAttribute });
  /** Tints every even body row. */
  public readonly striped = input<boolean, unknown>(false, { transform: booleanAttribute });
  /** Rows highlight on hover, show a pointer, take keyboard focus and report `rowActivate` on click, Enter or Space. Treat that as a shortcut: put the primary action in a cell as a link or button, because a screen reader announces the row as an ordinary row. */
  public readonly interactive = input<boolean, unknown>(false, { transform: booleanAttribute });
  /** Text of the single row shown when there are no rows. */
  public readonly emptyLabel = input<string>('No results');
  /** The sorted column and direction. Two-way: `[(sort)]`. Clicking a sortable header sets it, flipping the direction on the same column. */
  public readonly sort = model<UiTableSort | null>(null);
  /** The row that was clicked or activated from the keyboard on an `interactive` table. */
  public readonly rowActivate = output<Record<string, unknown>>();

  protected readonly cellDirectives = contentChildren(UiTableCellDirective);
  protected readonly cellTemplates: Signal<Map<string, UiTableCellDirective['template']>> = this.initCellTemplates();
  protected readonly columnViews: Signal<UiTableColumnView[]> = this.initColumnViews();
  protected readonly hostClasses: Signal<string> = this.initHostClasses();
  protected readonly rowClasses: Signal<string> = this.initRowClasses();

  protected toggleSort(column: UiTableColumn): void {
    const sort = this.sort();
    const direction = sort?.key === column.key && sort.direction === 'asc' ? 'desc' : 'asc';
    this.sort.set({ key: column.key, direction });
  }

  protected activate(row: Record<string, unknown>): void {
    if (this.interactive()) this.rowActivate.emit(row);
  }

  protected onRowClick(event: Event, row: Record<string, unknown>): void {
    // A click on a link, button, field or label inside the row belongs to that control, not to the row.
    const inner = (event.target as Element).closest('a, button, input, select, textarea, label, [role="button"], [tabindex]');
    if (inner && inner !== event.currentTarget) return;
    this.activate(row);
  }

  protected onRowKey(event: Event, row: Record<string, unknown>): void {
    // Keys pressed on a control inside the row belong to that control.
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    this.activate(row);
  }

  private initCellTemplates(): Signal<Map<string, UiTableCellDirective['template']>> {
    return computed(() => new Map(this.cellDirectives().map((cell) => [cell.key(), cell.template])));
  }

  private initColumnViews(): Signal<UiTableColumnView[]> {
    return computed(() => {
      // Exact px: 12px cell padding with 16px on the outer columns, and 13px header type, are library steps below the ui spacing scale.
      const pad = 'px-[12px] first:pl-[16px] last:pr-[16px]';
      const rule = 'border-b border-ui-neutral-alpha-200';
      const hover = this.interactive() ? 'group-hover:bg-ui-neutral-alpha-50' : '';
      const sort = this.sort();
      const templates = this.cellTemplates();
      return this.columns().map((column) => {
        const align = column.align === 'end' ? 'text-right tabular-nums' : 'text-left';
        const sorted = sort?.key === column.key ? sort.direction : null;
        const sortIcons = { asc: 'fa-light fa-arrow-up', desc: 'fa-light fa-arrow-down' };
        const ariaSorts = { asc: 'ascending', desc: 'descending' } as const;
        return {
          column,
          headClasses: `h-[40px] ${pad} ${align} ${rule} align-middle whitespace-nowrap bg-ui-background-200 label-13 font-medium text-ui-neutral-600`,
          bodyClasses: `h-ui-row ${pad} ${align} ${rule} align-middle ${column.muted ? 'text-ui-neutral-600' : 'text-ui-neutral-900'} ${hover}`,
          footClasses: `h-ui-row ${pad} ${align} align-middle bg-ui-background-200 font-medium text-ui-neutral-900`,
          ariaSort: sorted ? ariaSorts[sorted] : null,
          template: templates.get(column.key) ?? null,
          sortIcon: sorted ? sortIcons[sorted] : 'fa-light fa-arrow-up-arrow-down text-ui-neutral-500',
        };
      });
    });
  }

  private initHostClasses(): Signal<string> {
    return computed(() => {
      const ring = this.bordered() ? 'rounded-ui-sm shadow-border' : '';
      return `block w-full overflow-x-auto copy-14 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ui-focus ${ring}`;
    });
  }

  private initRowClasses(): Signal<string> {
    return computed(() => {
      const stripe = this.striped() ? 'even:bg-ui-background-200' : '';
      const interactive = this.interactive()
        ? 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ui-focus'
        : '';
      return `group ${stripe} ${interactive}`;
    });
  }
}
