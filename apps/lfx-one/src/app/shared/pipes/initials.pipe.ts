// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'initials',
  standalone: true,
  pure: true,
})
export class InitialsPipe implements PipeTransform {
  public transform(name: string, maxChars: number = 2): string {
    const words = name
      .trim()
      .split(/[\s-]+/)
      .filter((w) => w.length > 0);
    if (words.length === 0) return '?';
    return words
      .slice(0, maxChars)
      .map((w) => w.charAt(0).toUpperCase())
      .join('');
  }
}
