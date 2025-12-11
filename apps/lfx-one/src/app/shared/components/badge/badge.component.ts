// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input } from '@angular/core';
import { BadgeProps } from '@lfx-one/shared/interfaces';
import { BadgeModule } from 'primeng/badge';

@Component({
  selector: 'lfx-badge',
  imports: [BadgeModule],
  templateUrl: './badge.component.html',
})
export class BadgeComponent {
  public readonly value = input<BadgeProps['value']>('');
  public readonly severity = input<BadgeProps['severity']>('info');
  public readonly size = input<BadgeProps['size']>('small');
  public readonly styleClass = input<BadgeProps['styleClass']>('');
  public readonly badgeDisabled = input<BadgeProps['badgeDisabled']>(false);
}
