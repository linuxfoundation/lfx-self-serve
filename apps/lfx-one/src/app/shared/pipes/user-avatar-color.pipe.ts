// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';
import { AVATAR_COLORS } from '@lfx-one/shared/constants';
import { UserSearchResult } from '@lfx-one/shared/interfaces';

/**
 * Returns a deterministic Tailwind background-color class for a user avatar,
 * derived from the char code of the first character of the user's email.
 */
@Pipe({
  name: 'userAvatarColor',
})
export class UserAvatarColorPipe implements PipeTransform {
  public transform(user: UserSearchResult | null | undefined): string {
    const index = (user?.email?.charCodeAt(0) ?? 0) % AVATAR_COLORS.length;
    return AVATAR_COLORS[index];
  }
}
