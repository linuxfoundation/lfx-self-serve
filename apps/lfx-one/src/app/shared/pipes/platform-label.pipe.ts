// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';
import { getChatPlatformLabel, getRepoPlatformLabel } from '@lfx-one/shared/utils';

@Pipe({
  name: 'platformLabel',
  pure: true,
})
export class PlatformLabelPipe implements PipeTransform {
  public transform(url: string | null | undefined, type: 'chat' | 'repo' = 'chat'): string {
    return type === 'chat' ? getChatPlatformLabel(url) : getRepoPlatformLabel(url);
  }
}
