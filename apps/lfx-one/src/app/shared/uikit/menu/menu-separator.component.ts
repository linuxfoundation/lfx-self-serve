// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component } from '@angular/core';

/** A full-bleed 1px rule between groups of items in a `lfx-ui-menu`. */
@Component({
  selector: 'lfx-ui-menu-separator',
  templateUrl: './menu-separator.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'separator',
    // Exact px, not rem; 14px root. The -6px side margins cancel the menu's padding.
    class: 'my-[6px] -mx-[6px] block h-[1px] shrink-0 bg-ui-neutral-alpha-200',
    'data-testid': 'ui-menu-separator',
  },
})
export class UiMenuSeparatorComponent {}
