// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, input } from '@angular/core';
import { TagProps } from '@lfx-one/shared/interfaces';
import { TagModule } from 'primeng/tag';

@Component({
  selector: 'lfx-tag',
  standalone: true,
  imports: [CommonModule, TagModule],
  templateUrl: './tag.component.html',
})
export class TagComponent {
  public readonly value = input.required<TagProps['value']>();
  public readonly severity = input<TagProps['severity']>('secondary');
  public readonly icon = input<TagProps['icon']>();
  public readonly rounded = input<TagProps['rounded']>(false);
  public readonly styleClass = input<TagProps['styleClass']>('');
}
