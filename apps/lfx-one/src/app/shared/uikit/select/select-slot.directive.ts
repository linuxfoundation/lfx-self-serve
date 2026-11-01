// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Directive } from '@angular/core';

/**
 * Marks the `lfxUiSelectHeader` and `lfxUiSelectEmpty` content of `lfx-ui-select`, so the select knows the panel has something to show when no
 * option is projected. Import it wherever you project either slot; without it, a select with no options and no other content stays closed.
 */
@Directive({
  selector: '[lfxUiSelectHeader], [lfxUiSelectEmpty]',
})
export class UiSelectSlotDirective {}
