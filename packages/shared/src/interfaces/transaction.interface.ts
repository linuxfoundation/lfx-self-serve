// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import {
  TRANSACTION_TYPE_BUNDLE,
  TRANSACTION_TYPE_CERTIFICATION,
  TRANSACTION_TYPE_EVENT,
  TRANSACTION_TYPE_INDIVIDUAL_SUPPORT,
  TRANSACTION_TYPE_SUBSCRIPTION,
  TRANSACTION_TYPE_TRAINING,
} from '../constants/transaction.constants';

/** Union of all known TRANSACTION_TYPE values */
export type TransactionType =
  | typeof TRANSACTION_TYPE_EVENT
  | typeof TRANSACTION_TYPE_TRAINING
  | typeof TRANSACTION_TYPE_CERTIFICATION
  | typeof TRANSACTION_TYPE_SUBSCRIPTION
  | typeof TRANSACTION_TYPE_INDIVIDUAL_SUPPORT
  | typeof TRANSACTION_TYPE_BUNDLE;

/**
 * A single transaction in the user's purchase history
 */
export interface Transaction {
  /** Unique record identifier (_KEY) */
  id: string;
  /** Source natural key — purchase_id, registration_id, or membership id (ORDER_ID) */
  orderId: string;
  /** Transaction date (CREATED_DATE) */
  createdDate: string;
  /** Name of the purchased product (NAME) */
  name: string;
  /** Type of transaction: training, certifications, subscription, events, individual (TRANSACTION_TYPE) */
  transactionType: TransactionType | null;
  /** Net revenue amount paid (NET_REVENUE) */
  netRevenue: number;
  /** Associated project ID (PROJECT_ID) */
  projectId: string | null;
  /** Associated project name (PROJECT_NAME) */
  projectName: string | null;
}

/**
 * Snowflake row shape for ANALYTICS.PLATINUM_LFX_ONE.USER_TRANSACTIONS
 */
export interface TransactionRow {
  _KEY: string;
  USER_NAME?: string;
  USER_EMAIL?: string | null;
  USER_ID?: string | null;
  ORDER_ID: string;
  NAME: string | null;
  NET_REVENUE: number | null;
  CREATED_DATE: string;
  TRANSACTION_TYPE: TransactionType | null;
  PROJECT_ID: string | null;
  PROJECT_NAME: string | null;
}
