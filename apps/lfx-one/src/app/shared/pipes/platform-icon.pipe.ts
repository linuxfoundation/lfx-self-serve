// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';
import { getChatPlatformIcon, getRepoPlatformIcon } from '@lfx-one/shared/utils';

@Pipe({
  name: 'platformIcon',
  pure: true,
})
export class PlatformIconPipe implements PipeTransform {
  public transform(url: string | null | undefined, type: 'chat' | 'repo' = 'chat'): string {
    return type === 'chat' ? getChatPlatformIcon(url) : getRepoPlatformIcon(url);
  }
}
