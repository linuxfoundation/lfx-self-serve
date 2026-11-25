// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import type { TransactionType } from '../interfaces/transaction.interface';

/** TRANSACTION_TYPE values from ANALYTICS.PLATINUM_LFX_ONE.USER_TRANSACTIONS */
export const TRANSACTION_TYPE_EVENT = 'events' as const;
export const TRANSACTION_TYPE_TRAINING = 'training' as const;
export const TRANSACTION_TYPE_CERTIFICATION = 'certifications' as const;
export const TRANSACTION_TYPE_SUBSCRIPTION = 'subscription' as const;
export const TRANSACTION_TYPE_INDIVIDUAL_SUPPORT = 'individual' as const;
export const TRANSACTION_TYPE_BUNDLE = 'bundle' as const;

/** What the Account & Settings Transactions table calls each type, worded like its tabs. */
export const TRANSACTION_TYPE_LABELS: Record<TransactionType, string> = {
  [TRANSACTION_TYPE_EVENT]: 'Event Ticket',
  [TRANSACTION_TYPE_TRAINING]: 'Training',
  [TRANSACTION_TYPE_CERTIFICATION]: 'Certification',
  [TRANSACTION_TYPE_SUBSCRIPTION]: 'Subscription',
  [TRANSACTION_TYPE_INDIVIDUAL_SUPPORT]: 'Individual Support',
  [TRANSACTION_TYPE_BUNDLE]: 'Bundle',
};

/** Copy of Account & Settings › Transactions (#6078). */
export const ACCOUNT_TRANSACTIONS_COPY = {
  heading: 'Transactions',
  tabsLabel: 'Transaction type',
  emptyTitle: 'No transactions found',
  emptyText:
    'Recent purchases may take up to 48 hours to appear. Purchases from Linux Foundation training, certifications, events and memberships show up here.',
  pageSize: 10,
} as const;
