// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Directive, inject, input, TemplateRef } from '@angular/core';
import { UiTableColumn } from '@lfx-one/shared/interfaces';

/** What a custom cell template receives: the row as the implicit value and the column as `column`. */
export interface UiTableCellContext {
  $implicit: Record<string, unknown>;
  column: UiTableColumn;
}

/**
 * Marks an `<ng-template>` inside `lfx-ui-table` as the body cell for one column, for content such as a badge or a link.
 * Use `<ng-template lfxUiTableCell="role" let-row>`; `let-column="column"` gives the column definition.
 */
@Directive({
  selector: 'ng-template[lfxUiTableCell]',
})
export class UiTableCellDirective {
  /** Key of the column this template renders. */
  public readonly key = input.required<string>({ alias: 'lfxUiTableCell' });
  public readonly template = inject<TemplateRef<UiTableCellContext>>(TemplateRef);
}
