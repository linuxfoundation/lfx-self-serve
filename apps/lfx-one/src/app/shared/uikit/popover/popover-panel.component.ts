// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, input, TemplateRef } from '@angular/core';
import { UiPopoverContext } from '@lfx-one/shared/interfaces';

/**
 * The popover panel that `UiPopoverDirective` opens in a CDK overlay: a non-modal `role="dialog"` in the Menu material. It has no padding,
 * so the projected template owns its own spacing. Not used on its own.
 */
@Component({
  selector: 'lfx-ui-popover-panel',
  imports: [NgTemplateOutlet],
  templateUrl: './popover-panel.component.html',
  styleUrl: './popover-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    // Exact px, not rem; 14px root. Flex so the connected overlay can shrink and scroll the panel near the window edge.
    class:
      'flex max-w-[calc(100vw-16px)] min-h-0 flex-1 flex-col overflow-y-auto rounded-ui-md bg-ui-background-100 text-ui-neutral-900 shadow-menu outline-none',
    role: 'dialog',
    tabindex: '-1',
    '[attr.id]': 'panelId()',
    '[attr.aria-label]': 'label() || null',
    '[attr.aria-labelledby]': 'label() ? null : labelledBy() || null',
    '[style.width.px]': 'width()',
    'data-testid': 'ui-popover-panel',
  },
})
export class UiPopoverPanelComponent {
  /** The content the trigger passed in. */
  public readonly template = input.required<TemplateRef<UiPopoverContext>>();
  /** What the template receives. */
  public readonly context = input.required<UiPopoverContext>();
  /** DOM id the trigger points `aria-controls` at. */
  public readonly panelId = input<string>('');
  /** Accessible name. When empty the dialog is named by `labelledBy`. */
  public readonly label = input<string>('');
  /** Id of the element that names the dialog, normally the trigger. */
  public readonly labelledBy = input<string>('');
  /** Fixed width in px, or `null` to size to the content. */
  public readonly width = input<number | null>(null);
}
