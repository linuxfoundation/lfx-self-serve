// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { INSIGHTS_TOKEN_ERROR_CODES } from '../constants/insights-tokens.constants';

/** Token as returned by `lfx-v2-pat-service` (`GET /tokens`, `POST /tokens`). Never carries the secret. */
export interface PatServiceToken {
  uid: string;
  name: string;
  audience: string;
  lookup_id: string;
  username: string;
  created_at: string;
  last_used_at?: string;
}

/** `GET /tokens?audience=` response from `lfx-v2-pat-service`. */
export interface PatServiceListResponse {
  tokens: PatServiceToken[];
}

/** `POST /tokens` response from `lfx-v2-pat-service`. `secret` appears only here, once. */
export interface PatServiceCreateResponse {
  secret: string;
  token: PatServiceToken;
}

/** Insights API token as exposed by the BFF to the UI. */
export interface InsightsToken {
  uid: string;
  name: string;
  lookupId: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface CreateInsightsTokenResponse {
  token: InsightsToken;
  /** Plaintext `lfi_…` secret — returned once and never retrievable again. */
  secret: string;
}

/** Whether the caller may use Insights tokens: the `insights-public-api-token-access` flag is on for them. */
export interface InsightsTokenEligibility {
  canCreate: boolean;
  /** True when the eligibility request itself failed in the browser. `canCreate` is then false (fail closed), but the user may still be eligible. */
  checkFailed: boolean;
}

export type InsightsTokenErrorCode = (typeof INSIGHTS_TOKEN_ERROR_CODES)[keyof typeof INSIGHTS_TOKEN_ERROR_CODES];

/** Data passed to the reveal dialog. */
export interface InsightsTokenRevealDialogData {
  name: string;
  secret: string;
}

/** Display model for one row of the Insights token list. */
export interface InsightsTokenListItem {
  token: InsightsToken;
  maskedValue: string;
  lastUsedLabel: string;
}
