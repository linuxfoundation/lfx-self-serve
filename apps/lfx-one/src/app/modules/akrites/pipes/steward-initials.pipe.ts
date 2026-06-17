// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';

import { AkritesSteward } from '@lfx-one/shared/interfaces';

@Pipe({ name: 'stewardInitials', pure: true })
export class StewardInitialsPipe implements PipeTransform {
  transform(steward: AkritesSteward): string {
    if (steward.name) {
      const parts = steward.name.trim().split(/\s+/);
      return parts.length >= 2 ? `${parts[0][0]}${parts[1][0]}`.toUpperCase() : parts[0].slice(0, 2).toUpperCase();
    }
    // Auth0 sub format: "auth0|abc123" — use first 2 chars after the pipe
    const sub = steward.userId.split('|')[1] ?? steward.userId;
    return sub.slice(0, 2).toUpperCase();
  }
}
