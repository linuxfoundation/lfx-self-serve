// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input } from '@angular/core';
import { TagProps, TagSeverity } from '@lfx-one/shared/interfaces';
import { TagModule } from 'primeng/tag';

@Component({
  selector: 'lfx-tag',
  imports: [TagModule],
  templateUrl: './tag.component.html',
})
export class TagComponent {
  public readonly value = input.required<TagProps['value']>();
  public readonly severity = input<TagProps['severity']>('secondary');
  public readonly icon = input<TagProps['icon']>();
  public readonly rounded = input<TagProps['rounded']>(false);
  public readonly styleClass = input<TagProps['styleClass']>('');
  /** Renders a small filled circle dot before the label using the severity text color. */
  public readonly dot = input<TagProps['dot']>(false);
  /** Renders the tag with a border and transparent background instead of a filled background. */
  public readonly outlined = input<TagProps['outlined']>(false);

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
