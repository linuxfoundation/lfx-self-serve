// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component } from '@angular/core';

/** A full-bleed 1px rule between groups of options. Purely visual: a listbox may only own options and groups, so it is hidden from assistive technology. */
@Component({
  selector: 'lfx-ui-option-separator',
  templateUrl: './option-separator.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    'aria-hidden': 'true',
    // Exact px, not rem; 14px root. The -6px side margins cancel the panel's padding.
    class: 'my-[6px] -mx-[6px] block h-[1px] shrink-0 bg-ui-neutral-alpha-200',
    'data-testid': 'ui-option-separator',
  },
})
export class UiOptionSeparatorComponent {}
