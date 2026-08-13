// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';

/**
 * Formats a raw Social Listening tag for display: underscores become spaces, each word is
 * capitalized, and `ai` is special-cased to `AI` (e.g. `ai_agents` -> `AI Agents`).
 */
@Pipe({
  name: 'formatTag',
})
export class FormatTagPipe implements PipeTransform {
  public transform(value: string): string {
    if (!value) {
      return '';
    }

    return value
      .split('_')
      .map((word) => (word === 'ai' ? 'AI' : word.charAt(0).toUpperCase() + word.slice(1)))
      .join(' ');
  }
}
