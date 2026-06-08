// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Pipe, PipeTransform } from '@angular/core';
import { DUE_DATE_LABELS } from '@lfx-one/shared';

// Keyed off the labels emitted by DueDateLabelPipe; defaults to neutral gray.
const DUE_DATE_LABEL_COLORS: Record<string, string> = {
  [DUE_DATE_LABELS.CLOSES_TODAY]: 'text-red-600',
  [DUE_DATE_LABELS.CLOSES_TOMORROW]: 'text-amber-600',
};

const DEFAULT_DUE_DATE_LABEL_COLOR = 'text-gray-500';

@Pipe({
  name: 'dueDateLabelColor',
})
export class DueDateLabelColorPipe implements PipeTransform {
  public transform(dueDateLabel: string): string {
    return DUE_DATE_LABEL_COLORS[dueDateLabel] || DEFAULT_DUE_DATE_LABEL_COLOR;
  }
}
