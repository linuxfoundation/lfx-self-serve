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

// The list endpoint intentionally omits open_rate/unique_opens (per-newsletter
// analytics need a separate /analytics call upstream), so the list page fans
// out one analytics request per sent row. Caps each fan-out batch (initial page
// or load-more) — batches are user-paced, so this is a per-batch ceiling, not a
// global one.
export const NEWSLETTER_ANALYTICS_FETCH_CONCURRENCY = 5;

// Per-request timeout for the send endpoint, overriding the API client's 30s
// default. The new upstream accepts sends in well under a second (202 +
// background fan-out), but while a pre-async newsletter-service is deployed
// the synchronous fan-out for large audiences can run several minutes — the
// AAIF incident (LFXV2-2604) measured 37-41s for ~500 recipients, past the
// 30s abort, so the UI reported failure for sends that actually delivered.
export const NEWSLETTER_SEND_TIMEOUT_MS = 120_000;

// Reserved block-content keys holding the per-block outer spacing applied as a
// wrapping style when the block renders. Mirrors gatewaze's auto-injected
// `_spacing_padding` / `_spacing_margin` props (see the Puck editor's
// spacing-wrapper.tsx) so the composer canvas and the eventual sent email wrap
// each block identically. Values are raw CSS shorthand strings (e.g. "12px",
// "8px 16px"); the default `0px` means "no wrapper" (matches gatewaze).
export const NEWSLETTER_SPACING_PADDING_KEY = '_spacing_padding';
export const NEWSLETTER_SPACING_MARGIN_KEY = '_spacing_margin';
export const NEWSLETTER_SPACING_KEYS = [NEWSLETTER_SPACING_PADDING_KEY, NEWSLETTER_SPACING_MARGIN_KEY] as const;
export const NEWSLETTER_SPACING_DEFAULT = '0px';

// Fallback embedded template set the block composer loads when a newsletter
// carries no explicit `template_key` (e.g. a brand-new draft). The full AAIF
// set is the render superset in the newsletter service, so it's the safe
// default; a draft with a stored `template_key` uses that instead.
export const NEWSLETTER_DEFAULT_TEMPLATE_KEY = 'aaif-user-community';
