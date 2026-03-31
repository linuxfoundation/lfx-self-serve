// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';
import { UserSearchResult } from '@lfx-one/shared/interfaces';

/**
 * Returns uppercase initials (max 2 chars) for a user avatar.
 * Uses first + last name initials; falls back to first char of email.
 */
@Pipe({
  name: 'userInitials',
})
export class UserInitialsPipe implements PipeTransform {
  public transform(user: UserSearchResult | null | undefined): string {
    if (!user) return '?';
    const first = user.first_name?.charAt(0) ?? '';
    const last = user.last_name?.charAt(0) ?? '';
    return (first + last).toUpperCase() || user.email?.charAt(0).toUpperCase() || '?';
  }
}
