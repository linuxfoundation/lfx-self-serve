// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

export const LENS_CONFIG = {
  DEFAULT_API_URL: 'https://lfx-ai.onrender.com',
  WORKFLOW_PATH: '/workflows/lfx-lens-workflow/runs',
  REQUEST_TIMEOUT_MS: 120_000,
  MAX_HISTORY_MESSAGES: 50,
} as const;

export const LENS_SUGGESTED_PROMPTS = [
  'How many active memberships does this project have?',
  'Show me the top contributors this month',
  'What is the commit activity trend?',
  'How many mailing list subscribers are there?',
] as const;
