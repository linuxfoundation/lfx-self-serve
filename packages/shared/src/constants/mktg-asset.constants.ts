// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Plugin DEVELOPER.md host lifecycle → LFX One vocabulary. `none` has no
 * asset; queued/drafting are generating, review/pending are draft. Approved
 * is used only for an approval recorded by the store, never an agent mode.
 */
export const MKTG_HOST_ASSET_STATES = {
  none: null,
  queued: 'generating',
  drafting: 'generating',
  review: 'draft',
  pending: 'draft',
  approved: 'approved',
} as const;

/** Shared note when no approved current is available to PDF/Slides. */
export const MKTG_ASSET_APPROVAL_REQUIRED_MESSAGE = 'Approve a revision first — PDF and Slides use the approved current.';

/**
 * Empty state of the report's failed-sources list (the "Could not be read" card; on
 * the brand kit's Sources tab, "Failed sources"). It describes that list alone: the
 * notes beside it may still hold a source the agent could not reach.
 */
export const MKTG_ASSET_NO_SOURCE_FAILED_MESSAGE = 'No source failed.';

/** The five lists of an approval's snapshot: what a report showed when a revision was approved, by stable key. */
export const MKTG_ACCEPTED_KEYS = ['sources_failed', 'missing_assets', 'warnings', 'gaps', 'color_conflicts'] as const;

// ---------------------------------------------------------------------------
// Report v2: the findings groups every agent's report may carry (the Brand Kit's first, brand-kit ≥ 2.2.0; the
// framework, boilerplates and FAQ agents after it), the limits the validator holds them to, and the words the
// Sources tab and the approve dialog print for them. The kit's constants alias these, so there is one source of words.
// ---------------------------------------------------------------------------

/** The report version that carries the findings; absent means the v1 report. */
export const MKTG_REPORT_V2 = 2;
/** The report keys a v2 report adds to the v1 four; a validator strict to its keys allows these too. */
export const MKTG_REPORT_V2_KEYS = ['version', 'findings'] as const;
/** The findings groups of a v2 report, in reading order. */
export const MKTG_REPORT_FINDINGS_GROUPS = ['failed', 'missing', 'warnings'] as const;
/** Every reason, text and fix of a finding is a trimmed sentence of at most this many characters. */
export const MKTG_REPORT_TEXT_MAX_CHARS = 300;
/** A sentence that is nothing but an address, in any case: it belongs in `source`, not in a reason, text or fix. */
export const MKTG_REPORT_BARE_URL_REGEX = /^https?:\/\/\S+$/i;
/** No findings group grows past this. */
export const MKTG_REPORT_LIST_MAX = 50;
/** What each findings group is called on the Sources tab and in the approve dialog. */
export const MKTG_REPORT_FINDINGS_TITLES = {
  failed: 'Failed sources',
  missing: 'Missing assets',
  warnings: 'Warnings',
} as const satisfies Record<(typeof MKTG_REPORT_FINDINGS_GROUPS)[number], string>;
/** What each findings group says when it has nothing to list. */
export const MKTG_REPORT_FINDINGS_EMPTY_LINES = {
  failed: MKTG_ASSET_NO_SOURCE_FAILED_MESSAGE,
  missing: 'Nothing is missing.',
  warnings: 'No warnings.',
} as const satisfies Record<(typeof MKTG_REPORT_FINDINGS_GROUPS)[number], string>;
/** Before a missing asset's fix, when the agent names one. */
export const MKTG_REPORT_MISSING_FIX_PREFIX = 'Fix: ';
/** The Sources tab's title over the report's gaps lines; the approve dialog's Gaps group bears the same. */
export const MKTG_REPORT_GAPS_TITLE = 'Gaps';
/**
 * How the Sources tab and the approve dialog name each asset an agent may report missing: the Brand Kit's eight and
 * the family's (the framework, boilerplates and FAQ agents' shared contract, with their agent-specific extras). An
 * id with no label here prints as written; the UI never invents a sentence for it.
 */
export const MKTG_REPORT_ASSET_LABELS = {
  logo_primary: 'Primary logo',
  logo_stacked: 'Stacked logo',
  logo_symbol: 'Symbol',
  logo_reversed: 'Reversed logo',
  brand_page: 'Brand page',
  font_weights: 'Font weights',
  palette_accent: 'Accent colour',
  framework: 'Messaging framework',
  website: 'Website',
  press_release: 'Press release',
  lfx_record: 'LFX record',
  unanswered_question: 'Open question',
  key_numbers: 'Key numbers',
  member_count: 'Member count',
  pricing: 'Membership prices',
  sources_thin: 'Thin sources',
  objection_not_covered: 'Objection not covered',
} as const satisfies Readonly<Record<string, string>>;

/** The approve dialog's header when the report has a source that could not be read or an open gap (what "Approve anyway" accepts). */
export const MKTG_APPROVE_HEADER_GAPS = 'Approve with open gaps?';
/** The approve dialog's header when the report has only what the reviewer should see first (a Brand Kit's colour conflicts or LF-reference rules). */
export const MKTG_APPROVE_HEADER = 'Approve this version?';

// ---------------------------------------------------------------------------
// What a revision inherits (`report.inherited`) and the PREVIOUS RUN block that carries it: a mirror of
// marketing-os-agents `agents/<agent>/src/inherited.ts`, one byte-identical file for the framework, FAQ, boilerplates
// and Brand Kit agents. The limits are the agents' own; the renderer fits the block under them, the validator holds
// the envelope key to them.
// ---------------------------------------------------------------------------

/** The report key a revision's carry adds; a validator strict to its keys allows it too. */
export const MKTG_REPORT_INHERITED_KEY = 'inherited';
/** The lists of the Sources tab a revision may inherit rows into: the sources read, then the findings groups. */
export const MKTG_INHERITED_GROUPS = ['read', ...MKTG_REPORT_FINDINGS_GROUPS] as const;
/** What stands beside an inherited row of each list, before the number of the version whose run produced it. */
export const MKTG_INHERITED_MARKERS = {
  read: 'Read in version',
  failed: 'Could not be read in version',
  missing: 'Missing in version',
  warnings: 'Noted in version',
} as const satisfies Record<(typeof MKTG_INHERITED_GROUPS)[number], string>;
/** `report.inherited.sources_read` holds at most this many rows. */
export const MKTG_INHERITED_SOURCES_MAX = 200;
/** Every other list of `report.inherited` holds at most this many rows. */
export const MKTG_INHERITED_ROWS_MAX = 50;
/** A source, a name, a machine reason, a kind or a code: one line, at most this long. */
export const MKTG_INHERITED_NAME_MAX_CHARS = 500;
/** A sentence a person reads (a finding's reason, its fix, a warning's text): one line, at most this long. */
export const MKTG_INHERITED_SENTENCE_MAX_CHARS = 300;
/** The PREVIOUS RUN block's body is at most this many characters; the agent refuses an intake whose block is longer. */
export const MKTG_PREVIOUS_RUN_MAX_CHARS = 60_000;
/** The keys and brackets around the block's rows: an upper bound, so the rows are fitted under the rest. */
export const MKTG_PREVIOUS_RUN_FRAME_CHARS = 1_000;
/** The block's closing line. */
export const MKTG_PREVIOUS_RUN_END = '--- END PREVIOUS RUN ---';
/** The name the family gives the LFX standard metrics, and how a report's own wording of it is recognised. */
export const MKTG_INHERITED_LFX_METRICS_SOURCE = 'LFX standard metrics';
export const MKTG_INHERITED_LFX_METRICS_REGEX = /^LFX (?:standard )?metrics\b/i;
/** Every run of white space and control characters (line breaks, tabs, the C0 and C1 controls, the line and paragraph separators, a byte-order mark). */
// eslint-disable-next-line no-control-regex
export const MKTG_INHERITED_BREAKS_REGEX = /[\s\u0000-\u001f\u007f-\u009f\u2028\u2029\ufeff]+/g;
/** What a carried text may not hold (the agents' schema pattern): a line break or any other control character. */
// eslint-disable-next-line no-control-regex
export const MKTG_INHERITED_ONE_LINE_REGEX = /^[^\u0000-\u001f\u007f-\u009f\u2028\u2029]+$/;
