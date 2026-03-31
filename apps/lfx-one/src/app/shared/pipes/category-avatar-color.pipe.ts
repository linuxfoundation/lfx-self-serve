// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';
import { getCommitteeCategorySeverity } from '@lfx-one/shared';

const COLOR_MAP: Record<string, string> = {
  danger: 'bg-red-100 text-red-700',
  warn: 'bg-amber-100 text-amber-700',
  success: 'bg-emerald-100 text-emerald-700',
  info: 'bg-blue-100 text-blue-700',
  secondary: 'bg-purple-100 text-purple-700',
};

@Pipe({
  name: 'categoryAvatarColor',
  standalone: true,
  pure: true,
})
export class CategoryAvatarColorPipe implements PipeTransform {
  public transform(category: string): string {
    const severity = getCommitteeCategorySeverity(category);
    return COLOR_MAP[severity] || 'bg-gray-100 text-gray-700';
  }
}
