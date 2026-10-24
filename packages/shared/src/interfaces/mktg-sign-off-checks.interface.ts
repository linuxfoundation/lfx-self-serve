// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { MKTG_SIGN_OFF_CHECK_LABELS } from '../constants/mktg-sign-off-checks.constants';

export interface MktgSignOffCheck {
  id: keyof typeof MKTG_SIGN_OFF_CHECK_LABELS;
  label: string;
  status: 'pass' | 'fail' | 'n/a';
  detail: string;
}

export interface MktgSignOffChecksResponse {
  checks: MktgSignOffCheck[];
}
