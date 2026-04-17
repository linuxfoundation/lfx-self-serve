// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { Pipe, PipeTransform } from '@angular/core';
import {
  TRANSACTION_TYPE_BUNDLE,
  TRANSACTION_TYPE_CERTIFICATION,
  TRANSACTION_TYPE_EVENT,
  TRANSACTION_TYPE_INDIVIDUAL_SUPPORT,
  TRANSACTION_TYPE_SUBSCRIPTION,
  TRANSACTION_TYPE_TRAINING,
} from '@lfx-one/shared/constants';
import { TransactionType } from '@lfx-one/shared/interfaces';

const TYPE_STYLE_MAP: Record<TransactionType, string> = {
  [TRANSACTION_TYPE_EVENT]: '!bg-blue-50 !text-blue-700',
  [TRANSACTION_TYPE_TRAINING]: '!bg-emerald-50 !text-emerald-700',
  [TRANSACTION_TYPE_CERTIFICATION]: '!bg-violet-50 !text-violet-700',
  [TRANSACTION_TYPE_SUBSCRIPTION]: '!bg-amber-50 !text-amber-700',
  [TRANSACTION_TYPE_INDIVIDUAL_SUPPORT]: '!bg-rose-50 !text-rose-700',
  [TRANSACTION_TYPE_BUNDLE]: '!bg-teal-50 !text-teal-700',
};

@Pipe({ name: 'transactionTypeStyle' })
export class TransactionTypeStylePipe implements PipeTransform {
  public transform(value: TransactionType | null): string {
    return value ? (TYPE_STYLE_MAP[value] ?? '') : '';
  }
}
