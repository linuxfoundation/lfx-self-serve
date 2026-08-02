// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { Component, computed, input } from '@angular/core';
import { TagProps, TagSeverity } from '@lfx-one/shared/interfaces';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';

@Component({
  selector: 'lfx-tag',
  imports: [NgClass, TagModule, TooltipModule],
  templateUrl: './tag.component.html',
})
export class TagComponent {
  public readonly value = input.required<TagProps['value']>();
  public readonly severity = input<TagProps['severity']>('secondary');
  public readonly icon = input<TagProps['icon']>();
  public readonly rounded = input<TagProps['rounded']>(false);
  public readonly styleClass = input<TagProps['styleClass']>('');
  /** Renders a small filled circle dot before the label using the severity color. */
  public readonly dot = input<TagProps['dot']>(false);
  /** Renders the tag with a border and transparent background instead of a filled background. */
  public readonly outlined = input<TagProps['outlined']>(false);
  /**
   * Tooltip text for hover AND keyboard focus. Bound directly on this component's own rendered
   * element (`p-tag` or the plain `span` for `outlined`) rather than a wrapping element a consumer
   * might add — PrimeNG's tooltip directive resolves its focus/blur listener target via
   * `querySelector('.p-component')` on whatever element it sits on, falling back to the element
   * itself only when no such descendant exists. `p-tag`'s own host carries the `p-component` class,
   * so a consumer-side wrapping `<span pTooltip tabindex>` around `<lfx-tag>` finds `p-tag` as that
   * descendant and attaches the listener there — a DIFFERENT node than the one carrying `tabindex`,
   * so keyboard focus never fires it (LFXV2-1705 review). Applying it here instead, directly on
   * `p-tag`, makes `querySelector` find no descendant and fall back to `p-tag` itself — the same
   * node `tabindex` is on.
   */
  public readonly tooltip = input<TagProps['tooltip']>('');
  public readonly tooltipPosition = input<TagProps['tooltipPosition']>('top');

  protected readonly dotBgClass = computed(() => {
    const map: Record<TagSeverity, string> = {
      success: 'bg-emerald-500',
      info: 'bg-blue-500',
      warn: 'bg-amber-500',
      danger: 'bg-red-500',
      secondary: 'bg-gray-400',
      contrast: 'bg-gray-800',
    };
    return map[this.severity() ?? 'secondary'] ?? 'bg-gray-400';
  });
}
