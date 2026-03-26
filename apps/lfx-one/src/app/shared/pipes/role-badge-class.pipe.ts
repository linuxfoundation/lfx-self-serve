// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';

const ROLE_BADGE_CLASSES: Record<string, string> = {
  chair: 'bg-blue-100 text-blue-800',
  'vice chair': 'bg-indigo-100 text-indigo-800',
  member: 'bg-green-100 text-green-800',
  lead: 'bg-purple-100 text-purple-800',
};

const DEFAULT_BADGE_CLASS = 'bg-gray-100 text-gray-600';

@Pipe({
  name: 'roleBadgeClass',
  standalone: true,
})
export class RoleBadgeClassPipe implements PipeTransform {
  public transform(role: string): string {
    return ROLE_BADGE_CLASSES[role?.toLowerCase()] || DEFAULT_BADGE_CLASS;
  }
}
