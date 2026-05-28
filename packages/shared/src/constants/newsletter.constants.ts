// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

export const NEWSLETTER_TOTAL_STEPS = 3;

export const NEWSLETTER_STEP_TITLES: Record<number, string> = {
  1: 'Audience',
  2: 'Content',
  3: 'Send',
};

export const NEWSLETTER_PROMPT_STORAGE_KEY = 'lfx-newsletter-ai-prompt';

export const NEWSLETTER_RAW_CONTENT_MAX_LENGTH = 50_000;

// Cap must exceed the default AI_NEWSLETTER_SYSTEM_PROMPT (~6.2k chars) plus reasonable
// customization headroom — otherwise the default prompt fails the frontend validator on init
// and the Generate button never enables.
export const NEWSLETTER_SYSTEM_PROMPT_MAX_LENGTH = 20_000;

// Output-token ceiling for newsletter generation only. Kept separate from
// AI_REQUEST_CONFIG.MAX_TOKENS so the meeting-agenda flow keeps its
// conservative 4k cap. Claude Sonnet 4 supports up to 64k output tokens;
// 12k comfortably covers a ~40k-char HTML newsletter (the JSON schema
// caps bodyHtml at 100k chars, so we still have room before the schema
// pushes back).
export const NEWSLETTER_AI_MAX_TOKENS = 12_000;
