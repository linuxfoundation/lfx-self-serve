// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Directive, inject } from '@angular/core';
import { Tooltip } from 'primeng/tooltip';

/**
 * PrimeNG binds focus to a descendant .p-component when present, even if that
 * component is disabled. Keep keyboard activation on the focusable tooltip host.
 * Pair with tooltipEvent="hover" so PrimeNG retains its normal pointer behaviour.
 */
@Directive({
  selector: '[pTooltip][lfxTooltipHostFocus]',
  host: { '(focus)': 'show()', '(blur)': 'hide()' },
})
export class TooltipHostFocusDirective {
  private readonly tooltip = inject(Tooltip, { self: true });

  protected show(): void {
    this.tooltip.activate();
  }

  protected hide(): void {
    this.tooltip.deactivate();
  }
}
