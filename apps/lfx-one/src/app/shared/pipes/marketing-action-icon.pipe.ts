// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';
import { MARKETING_ACTION_ICON_MAP } from '@lfx-one/shared/constants';
import { MarketingActionType } from '@lfx-one/shared/interfaces';

@Pipe({
  standalone: true,
  name: 'marketingActionIcon',
})
export class MarketingActionIconPipe implements PipeTransform {
  public transform(type: MarketingActionType): string {
    return MARKETING_ACTION_ICON_MAP[type];
  }
}
