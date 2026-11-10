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

// Field limits enforced by NewsletterController.validateCommonPayload — shared
// so any other caller building a CreateNewsletterRequest (e.g. the weekly-brief
// share action) can validate up front instead of relying on an opaque upstream 400.
export const NEWSLETTER_SUBJECT_MAX_LENGTH = 200;
export const NEWSLETTER_BODY_MAX_LENGTH = 100_000;
// Structured layout is JSON, so it runs larger than the rendered HTML. Bound its
// serialized size in bytes so a save or test send, with the echoed body_html
// beside it, stays under the newsletter service's 1 MiB request limit.
export const NEWSLETTER_BODY_LAYOUT_MAX_BYTES = 800_000;
// render-preview's wrapper_content carries only a few edition.* fields.
export const NEWSLETTER_WRAPPER_CONTENT_MAX_BYTES = 16_384;

// Test sends per user per window (#4358 F1). A test send goes from the LF sending
// domain, so the cap and the own-address check are the guard against misuse.
export const NEWSLETTER_TEST_SEND_RATE_LIMIT_MAX = 20;
export const NEWSLETTER_TEST_SEND_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

// Cap must exceed the default AI_NEWSLETTER_SYSTEM_PROMPT (~6.2k chars) plus reasonable
// customization headroom — otherwise the default prompt fails the frontend validator on init
// and the Generate button never enables.
export const NEWSLETTER_SYSTEM_PROMPT_MAX_LENGTH = 20_000;

// Output-token ceiling for newsletter generation only. Kept separate from
// AI_REQUEST_CONFIG.MAX_TOKENS so the meeting-agenda flow keeps its
// conservative 4k cap. 12k comfortably covers a ~40k-char HTML newsletter
// (the JSON schema caps bodyHtml at 100k chars, so we still have room before
// the schema pushes back). It assumes a Claude-class model: the proxy's
// model_list also publishes smaller models whose own output ceiling sits
// below this cap, so revisit it alongside AI_MODEL.
export const NEWSLETTER_AI_MAX_TOKENS = 12_000;

// The list endpoint intentionally omits open_rate/unique_opens (per-newsletter
// analytics need a separate /analytics call upstream), so the list page fans
// out one analytics request per sent row. Caps each fan-out batch (initial page
// or load-more) — batches are user-paced, so this is a per-batch ceiling, not a
// global one.
export const NEWSLETTER_ANALYTICS_FETCH_CONCURRENCY = 5;

// Upstream caps the `top_links` click-analytics breakdown at the 20 highest-click
// links (lfx-v2-newsletter-service PR #76). Mirrored here so the "Top clicked
// links" card's display note and defensive display slice can't drift from
// upstream or from each other.
export const NEWSLETTER_TOP_LINKS_LIMIT = 20;

// Per-request timeout for the send endpoint, overriding the API client's 30s
// default. The new upstream accepts sends in well under a second (202 +
// background fan-out), but while a pre-async newsletter-service is deployed
// the synchronous fan-out for large audiences can run several minutes — the
// AAIF incident (LFXV2-2604) measured 37-41s for ~500 recipients, past the
// 30s abort, so the UI reported failure for sends that actually delivered.
export const NEWSLETTER_SEND_TIMEOUT_MS = 120_000;

// Reserved block-content keys holding the per-block outer spacing applied as a
// wrapping style when the block renders. Mirrors the source editor's
// auto-injected `_spacing_padding` / `_spacing_margin` props (see the Puck
// editor's spacing-wrapper.tsx) so the composer canvas and the eventual sent
// email wrap each block identically. Values are raw CSS shorthand strings
// (e.g. "12px", "8px 16px"); the default `0px` means "no wrapper".
export const NEWSLETTER_SPACING_PADDING_KEY = '_spacing_padding';
export const NEWSLETTER_SPACING_MARGIN_KEY = '_spacing_margin';
export const NEWSLETTER_SPACING_KEYS = [NEWSLETTER_SPACING_PADDING_KEY, NEWSLETTER_SPACING_MARGIN_KEY] as const;
export const NEWSLETTER_SPACING_DEFAULT = '0px';

// Template set a new draft starts with: the AAIF members newsletter (the ED
// weekly). The author can pick another set in the composer.
export const NEWSLETTER_DEFAULT_TEMPLATE_KEY = 'aaif-member';

// Publication limits. These match lfx-v2-newsletter-service's validation (#4349).
export const NEWSLETTER_PUBLICATION_NAME_MAX_LENGTH = 200;
export const NEWSLETTER_PUBLICATION_FROM_NAME_MAX_LENGTH = 100;
export const NEWSLETTER_PUBLICATION_REPLY_TO_MAX_LENGTH = 254;
// email-service refuses a reply-to with more than this many bytes before the @.
export const NEWSLETTER_REPLY_TO_LOCAL_PART_MAX_LENGTH = 64;
// The service lists 20 publications a page. A project has a handful, so this cap only stops a loop.
export const NEWSLETTER_PUBLICATION_MAX_PAGES = 25;
// The most committees one newsletter or publication audience can name.
export const NEWSLETTER_MAX_COMMITTEES = 50;
// Every newsletter status, for validating a status filter.
export const NEWSLETTER_STATUSES: readonly string[] = ['draft', 'sending', 'scheduled', 'sent'];

// Template set the newsletter service renders a layout with no `template_key`
// in (declarative.FallbackTemplateKey). Kept apart from the default above so a
// saved keyless layout still labels and loads as the service renders it.
export const NEWSLETTER_FALLBACK_TEMPLATE_KEY = 'aaif-user-community';

// Picker labels for the known template sets. Unknown keys use the service's label.
export const NEWSLETTER_TEMPLATE_LABELS: Record<string, string> = {
  'aaif-member': 'AAIF members (ED weekly)',
  'aaif-user-community': 'AAIF user community',
  'aaif-weekly-agentic': 'AAIF weekly agentic',
};

// UI-enforced minimum lead time for arming a schedule (LFXV2-2685). Must be
// >= the upstream's *effective* floor, which the send orchestrator computes
// as max(configured NEWSLETTER_SCHEDULE_MIN_LEAD, SendJobTimeout + 5m) —
// with the deployed SendJobTimeout default of 30m, that floor is 35m
// regardless of what NEWSLETTER_SCHEDULE_MIN_LEAD is set to. A UI floor
// below that lets an author pick a time upstream then rejects with a 400 at
// arm time. 35 minutes also clears SendGrid's 10-minute cancel buffer
// (NEWSLETTER_SCHEDULE_CANCEL_BUFFER) with room to spare.
export const NEWSLETTER_SCHEDULE_MIN_LEAD_MINUTES = 35;

// UI-enforced (and upstream-enforced) maximum horizon for arming a schedule.
// Matches SendGrid Mail Send's own send_at ceiling — the newsletter-service's
// NEWSLETTER_SCHEDULE_MAX_HORIZON defaults to and is hard-capped at 72h, so a
// larger value can never succeed at arm time regardless of what the UI allows.
export const NEWSLETTER_SCHEDULE_MAX_HORIZON_HOURS = 72;

// The block composer (structured body_layout editor) and its template library
// are gated to these project slugs; every other project uses the simple
// rich-text editor only, and the Blocks/Simple toggle is hidden. AAIF is the
// pilot for the blocks editor.
export const NEWSLETTER_BLOCKS_PROJECT_SLUGS: readonly string[] = ['agentic-ai-foundation'];

// Whether a block composer draft can do a real send or schedule. Off for the editor-only release,
// where the new editor only sends tests (#4345). Turn on for the first real send.
export const NEWSLETTER_BLOCKS_LIVE_SEND_ENABLED = false;

// The service leaves this token in a draft's rendered layout and fills it in at send time.
export const NEWSLETTER_SEND_DATE_PLACEHOLDER = '%%SEND_DATE%%';
// The service renders the send date in this timezone, so a preview has to match it.
export const NEWSLETTER_DATE_TIME_ZONE = 'America/Los_Angeles';

// The newsletter service rejects a rendered email over 100,000 bytes (422),
// which keeps it under Gmail's ~102 KB clipping point. The block composer warns
// as the email approaches that limit and shows the limit once it is reached.
export const NEWSLETTER_GMAIL_WARN_BYTES = 90 * 1024;
export const NEWSLETTER_BODY_HTML_MAX_BYTES = 100_000;
