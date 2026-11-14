// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Directive, inject, TemplateRef } from '@angular/core';
import { UiSelectValueContext } from '@lfx-one/shared/interfaces';

/**
 * Marks an `<ng-template>` inside `lfx-ui-select` as what the trigger shows for the picked option, for an avatar or a badge instead of plain text.
 * Use `<ng-template lfxUiSelectValue let-option>`: `option.value` and `option.label` identify the choice. The placeholder is unaffected.
 */
@Directive({
  selector: 'ng-template[lfxUiSelectValue]',
})
export class UiSelectValueDirective {
  public readonly template = inject<TemplateRef<UiSelectValueContext>>(TemplateRef);
}
