// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';
import { formatTag } from '@lfx-one/shared/utils';

/** Formats a raw Social Listening tag for display (`ai_agents` -> `AI Agents`). Thin wrapper over the standalone `formatTag` util (rule: pipes needing programmatic access wrap a function). */
@Pipe({
  name: 'formatTag',
})
export class FormatTagPipe implements PipeTransform {
  public transform(value: string): string {
    return formatTag(value);
  }
}
