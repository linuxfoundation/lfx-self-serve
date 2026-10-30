// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { TemplateRef } from '@angular/core';

/** A tab in the uikit underline tabs. */
export interface UiTabItem {
  /** Stable value written to the tabs' selected value when this tab is chosen. */
  value: string;
  /** Visible tab label. */
  label: string;
  /** Optional count shown after the label. */
  count?: number;
  /** Greys the tab out and removes it from keyboard navigation. */
  disabled?: boolean;
}

/** Colour role of a uikit badge and its status dot. `neutral` is the default. */
export type UiBadgeTone = 'neutral' | 'accent' | 'feature' | 'warning' | 'danger' | 'success';

/** Colour role that tints a uikit avatar. `neutral` is the quiet default. */
export type UiAvatarTone = 'neutral' | 'accent' | 'feature' | 'success' | 'warning' | 'danger';

/** A person, organization or bot shown in a uikit avatar group. */
export interface UiAvatarItem {
  /** The literal name. Becomes the avatar's accessible name and its initials. */
  name: string;
  /** Photo URL. When it is missing or fails to load, the initials show instead. */
  src?: string;
  /** Colour role that tints the initials circle, to tell people apart in dense lists. */
  tone?: UiAvatarTone;
}

/** Options for `UiModalService.open`. Every field is optional. */
export interface UiModalConfig<D = unknown> {
  /** Passed to the modal content, which reads it with the CDK `DIALOG_DATA` token. */
  data?: D;
  /** `alertdialog` for confirmations that need an answer, such as deleting something. Defaults to `dialog`. */
  role?: 'dialog' | 'alertdialog';
  /** Close when the user clicks the dimmed backdrop. Defaults to `true`. */
  closeOnBackdropClick?: boolean;
  /** Close when the user presses Escape. Defaults to `true`. */
  closeOnEscape?: boolean;
  /** Describe the dialog by its subtitle, so a screen reader reads the consequence when it opens. Set it only when the layout has a subtitle. */
  describedBy?: boolean;
  /** Element that gets focus on open: `first-tabbable` (default), `first-heading`, `dialog`, or a CSS selector such as `[data-autofocus]`. */
  autoFocus?: string;
}

/** One day button in a uikit calendar month grid. */
export interface UiCalendarDay {
  /** Local `YYYY-MM-DD` key. Stable per date. */
  key: string;
  /** The date at local midnight. */
  date: Date;
  /** Day of the month, shown on the button. */
  number: number;
  /** Full spoken date, such as "Monday, October 12, 2026". */
  label: string;
  /** True when the day belongs to the previous or next month. */
  outside: boolean;
  /** True for today. Read when the grid rebuilds, so it updates on the next change, not live at midnight. */
  today: boolean;
  /** True for the selected date. */
  selected: boolean;
  /** True when the consumer's disabled rule rejects the date. */
  disabled: boolean;
  /** Tailwind classes for the day button, covering today, selected, unavailable and form-disabled states. */
  classes: string;
}

/** One row of seven days in a uikit calendar month grid. */
export interface UiCalendarWeek {
  /** Key of the week's first day. Stable per week. */
  key: string;
  /** The seven days, in display order. */
  days: UiCalendarDay[];
}

/** Which side of its host a uikit tooltip prefers. */
export type UiTooltipSide = 'top' | 'right' | 'bottom' | 'left';

/** Size of a uikit toggle: `default` 28x16, `medium` 36x20 or `large` 44x24. */
export type UiToggleSize = 'default' | 'medium' | 'large';

/** Colour of a uikit toggle when on. `warning` and `danger` flag settings with consequences. */
export type UiToggleTone = 'accent' | 'warning' | 'danger';

/** Size of the uikit loading dots: 4, 5 or 7px dots. */
export type UiLoadingDotsSize = 'sm' | 'md' | 'lg';

/** Height of a uikit text input: `tiny` 24px, `small` 32px, `medium` 40px. Matches the button sizes. */
export type UiInputSize = 'tiny' | 'small' | 'medium';

/** Native `type` of a uikit text input. There is no `number`: it would hand forms a string. Use `text` with the input's `inputmode` instead. */
export type UiInputType = 'text' | 'email' | 'url' | 'tel' | 'password' | 'search';

/** Virtual keyboard hint of a uikit text input, the native `inputmode` values. */
export type UiInputMode = 'none' | 'text' | 'tel' | 'url' | 'email' | 'numeric' | 'decimal' | 'search';

/** Scroll axis of the uikit scroller: a snapping rail, a fading list, or a free two-axis pane. */
export type UiScrollerDirection = 'horizontal' | 'vertical' | 'both';

/** Colour role of a uikit project banner: `default` for a mode that is on, `gray` for a routine notice. */
export type UiProjectBannerVariant = 'default' | 'success' | 'warning' | 'error' | 'gray';

/** Horizontal alignment of a uikit table column. `end` right-aligns numbers and uses tabular figures. */
export type UiTableAlign = 'start' | 'end';

/** Direction a uikit table is sorted in. */
export type UiTableSortDirection = 'asc' | 'desc';

/** A column of the uikit table. */
export interface UiTableColumn {
  /** Row field this column shows. Also the key of the column's custom cell template and of its sort state. */
  key: string;
  /** Header text. */
  header: string;
  /** `end` for numbers. Defaults to `start`. The header follows the column. */
  align?: UiTableAlign;
  /** Shows the cells in the secondary text colour. */
  muted?: boolean;
  /** Turns the header into a button that asks for the table to be sorted by this column. */
  sortable?: boolean;
}

/** The column and direction a uikit table is sorted by. */
export interface UiTableSort {
  /** Key of the sorted column. */
  key: string;
  /** Sort direction. */
  direction: UiTableSortDirection;
}

/** What a custom uikit table cell template receives: the row as the implicit value and the column as `column`. */
export interface UiTableCellContext {
  /** The row object. */
  $implicit: Record<string, unknown>;
  /** The column this cell belongs to. */
  column: UiTableColumn;
}

/** Everything the uikit table template needs for one column, derived once from the columns, sort and interactive state. */
export interface UiTableColumnView {
  /** The column definition. */
  column: UiTableColumn;
  /** Classes of the header cell. */
  headClasses: string;
  /** Classes of the body cells. */
  bodyClasses: string;
  /** Classes of the footer cell. */
  footClasses: string;
  /** `aria-sort` of the header cell: set only on the sorted column. */
  ariaSort: 'ascending' | 'descending' | null;
  /** Custom body cell template for this column, if the page projected one. */
  template: TemplateRef<UiTableCellContext> | null;
  /** Font Awesome classes of the sort arrow of a sortable header. */
  sortIcon: string;
}

/** Size of a uikit collapse group: `default` has 20px headings, `small` 14px headings and tighter padding. */
export type UiCollapseSize = 'default' | 'small';

/** Heading level (`aria-level`) of the triggers in a uikit collapse group. */
export type UiCollapseHeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;
