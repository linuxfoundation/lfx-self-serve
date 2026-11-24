// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, Signal, TemplateRef } from '@angular/core';
import { UiPopoverPadding } from '@lfx-one/shared/interfaces';

/** The card `UiHoverCardDirective` opens in a CDK overlay: the Menu material on the large shadow, 16px of padding or none. Not used on its own. */
@Component({
  selector: 'lfx-ui-hover-card-panel',
  imports: [NgTemplateOutlet],
  templateUrl: './hover-card-panel.component.html',
  styleUrl: './hover-card-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    // Exact px, not rem; 14px root.
    class: 'flex max-w-[calc(100vw-16px)] flex-col overflow-hidden rounded-ui-md bg-ui-background-100 text-left text-ui-neutral-900 shadow-large',
    '[class]': 'paddingClass()',
    '[attr.id]': 'panelId()',
    '[style.width.px]': 'width()',
    'data-testid': 'ui-hover-card-panel',
  },
})
export class UiHoverCardPanelComponent {
  /** The content the host passed in. */
  public readonly template = input.required<TemplateRef<unknown>>();
  /** DOM id the host points `aria-describedby` at while the card is open. */
  public readonly panelId = input<string>('');
  /** Fixed width in px, or `null` to size to the content. */
  public readonly width = input<number | null>(null);
  /** `default` pads the content by 16px; `none` lets it run edge to edge, such as a tinted card that paints its own background. */
  public readonly padding = input<UiPopoverPadding>('default');

  // Exact px, not rem; 14px root.
  protected readonly paddingClass: Signal<string> = computed(() => (this.padding() === 'none' ? '' : 'p-[16px]'));
}
