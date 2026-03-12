// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { LensStreamStage } from '../interfaces/lens.interface';

/** Visual stages shown in the loading indicator (excludes 'complete' which is a terminal state) */
type LensVisualStage = Exclude<LensStreamStage, 'complete'>;

export const LENS_CONFIG = {
  DEFAULT_API_URL: 'https://lfx-ai.onrender.com',
  WORKFLOW_PATH: '/workflows/lfx-lens-workflow/runs',
  REQUEST_TIMEOUT_MS: 120_000,
  MAX_HISTORY_MESSAGES: 50,
} as const;

/** Stage configs for the multi-stage loading indicator */
export const LENS_STAGE_CONFIGS: Readonly<Record<LensVisualStage, { label: string; dotColor: string }>> = {
  starting: { label: 'Understanding question', dotColor: 'bg-violet-400' },
  analyzing: { label: 'Analyzing data', dotColor: 'bg-blue-400' },
  querying: { label: 'Running queries', dotColor: 'bg-emerald-400' },
  preparing: { label: 'Preparing results', dotColor: 'bg-pink-300' },
} as const;

/** Maps server status strings to frontend stream stages */
export const LENS_STATUS_TO_STAGE: Readonly<Record<string, LensStreamStage>> = {
  'Understanding your question...': 'starting',
  'Analyzing your question...': 'analyzing',
  'Running queries...': 'querying',
  'Preparing results...': 'preparing',
} as const;

/** Ordered list of stages for building the stage array */
export const LENS_STAGE_ORDER: readonly LensStreamStage[] = ['starting', 'analyzing', 'querying', 'preparing'] as const;

/** Suggested prompts for foundation-only context */
export const LENS_FOUNDATION_PROMPTS: readonly string[] = [
  'How many events did we host last year?',
  'How many members do we have right now?',
  'Show me the top contributors this month',
  'What is the commit activity trend?',
] as const;

/** Suggested prompts for foundation+company context */
export const LENS_COMPANY_PROMPTS: readonly string[] = [
  'How many employees attended events?',
  'How many contributors from my organization are active?',
  'What is our membership status?',
  'Show me our contribution trends',
] as const;
