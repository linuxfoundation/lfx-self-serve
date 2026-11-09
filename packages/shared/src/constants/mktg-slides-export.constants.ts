// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Export to Google Slides (slides-export-output/v1): the Guild agent
// linux-foundation~slides-export copies the LF 2025 Slides template into a
// Drive folder (or refreshes a deck it made before), applies the kit's brand
// to its layouts and fills it from an asset as LFX One stores it. Mirrors
// marketing-os-agents agents/slides-export 1.1.0 (src/form.ts,
// src/envelope.ts; docs/contracts/slides-export-output.md is the contract of
// record); a Brand Kit export's chapters need 1.1.0 or later. The rendered
// intake's marker lines are load-bearing: the agent parses them back.

import type { MktgSlidesExportAgentKey } from '../interfaces/mktg-slides-export.interface';
import { BRAND_KIT_HEX_REGEX, BRAND_KIT_PROJECT_SLUG_REGEX } from './brand-kit.constants';
import { MKTG_ARTIFACT_SHA256_REGEX } from './mktg-artifact.constants';
import { MKTG_RUN_ERROR_SETTLE_MS, MKTG_RUN_ERROR_TEARDOWN_MS } from './mktg-run.constants';

/** Maximum first-paint wait for a document's secondary export-history read. */
export const MKTG_DOCUMENT_EXPORT_HISTORY_WAIT_MS = 3000;

/** The BFF routes of the export. */
export const MKTG_SLIDES_EXPORT_API_PATH = '/api/mktg-agents/slides-export';

/** The exporter's Guild agent name; the workspace owner completes it (`linux-foundation~slides-export`). */
export const MKTG_SLIDES_EXPORT_GUILD_HANDLE = 'slides-export';

/** The agent identifier the envelope must carry. */
export const MKTG_SLIDES_EXPORT_AGENT_IDENTIFIER = 'linux-foundation~slides-export';

/** The contract id the exporter's result envelope carries. */
export const MKTG_SLIDES_EXPORT_CONTRACT_ID = 'slides-export-output/v1';

/** The envelope's `kind`. */
export const MKTG_SLIDES_EXPORT_KIND = 'slides-export';

/** How an export lands: a new deck in the folder, or the document's last deck refreshed in place. */
export const MKTG_SLIDES_EXPORT_MODES = ['create', 'update'] as const;

/** The asset members the exporter reads, in the deck's order. */
export const MKTG_SLIDES_EXPORT_ASSET_KINDS = ['framework', 'kit', 'boilerplates', 'faq'] as const;

/** The kinds of slide the envelope reports, one per slide filled. */
export const MKTG_SLIDES_EXPORT_SLIDE_KINDS = ['title', 'statement', 'section', 'bullets', 'text', 'two-columns', 'table', 'closing'] as const;

/** The documents LFX One exports today: the Messaging Framework and the Brand Kit. */
export const MKTG_SLIDES_EXPORT_AGENT_KEYS = ['foundation-message', 'brand-kit'] as const;

/** A content hash: 64 lowercase hex characters (the envelope's `content_sha256`, a revision's hash). */
export const MKTG_SLIDES_EXPORT_SHA256_REGEX = MKTG_ARTIFACT_SHA256_REGEX;

/** The envelope's project slug, as the Brand Kit contract shapes it. */
export const MKTG_SLIDES_EXPORT_PROJECT_SLUG_REGEX = BRAND_KIT_PROJECT_SLUG_REGEX;

/** A colour the envelope reports (`tables_header`), as the Brand Kit stores its colours. */
export const MKTG_SLIDES_EXPORT_HEX_REGEX = BRAND_KIT_HEX_REGEX;

/** A Drive file id, as the agent's form takes it. */
export const MKTG_SLIDES_EXPORT_DRIVE_ID_REGEX = /^[A-Za-z0-9_-]{10,}$/;

/** A deck link as the agent writes it (`deckLink`), found in an error that names the deck. */
export const MKTG_SLIDES_EXPORT_DECK_LINK_REGEX = /https:\/\/docs\.google\.com\/presentation\/d\/[A-Za-z0-9_-]{10,}\/edit/;

/** The Slides API fetches a logo from a URL of at most this many characters. */
export const MKTG_SLIDES_EXPORT_MAX_LOGO_URL_CHARS = 2000;

/** The rendered intake's marker lines (agents/slides-export/src/form.ts). */
export const MKTG_SLIDES_EXPORT_INTAKE_HEADER = 'BATCH INTAKE SUBMISSION (Slides export)';
export const MKTG_SLIDES_EXPORT_DECK_NONE = 'none (create a new deck from the LF 2025 template)';
export const MKTG_SLIDES_EXPORT_ASSETS_OPEN = '--- ASSETS (JSON) ---';
export const MKTG_SLIDES_EXPORT_ASSETS_CLOSE = '--- END ASSETS ---';

/** A new deck's title names what it holds, per asset. */
export const MKTG_SLIDES_EXPORT_DECK_TITLE_LABELS: Record<MktgSlidesExportAgentKey, string> = {
  'foundation-message': 'Messaging framework',
  'brand-kit': 'Brand kit',
};

/** What the export is called on screen, per asset. */
export const MKTG_SLIDES_EXPORT_ASSET_LABELS: Record<MktgSlidesExportAgentKey, string> = {
  'foundation-message': 'messaging framework',
  'brand-kit': 'brand kit',
};

/** The export record a deck is kept with: one immutable object per export, newest last. */
export const MKTG_SLIDES_EXPORT_RECORD_SCHEMA = 'mktg-slides-export/v1';

/** Export records live beside the document store, in the same private bucket, under their own prefix. */
export const MKTG_SLIDES_EXPORT_KEY_PREFIX = 'slides-exports';

/** Digits of the export time (epoch ms) that leads a record's key, so the newest record sorts last. */
export const MKTG_SLIDES_EXPORT_KEY_TIME_DIGITS = 15;

/**
 * The project logo as the server draws it from the kit's SVG: a PNG, since
 * the Slides API takes PNG, JPEG or GIF only. It is published under this
 * prefix of the public image bucket, content-addressed per project.
 */
export const MKTG_SLIDES_EXPORT_LOGO_KEY_PREFIX = 'mktg-slides-logos';
export const MKTG_SLIDES_EXPORT_LOGO_CONTENT_TYPE = 'image/png';
/** Largest drawn PNG published, in bytes (a logo at the drawing size is far smaller). */
export const MKTG_SLIDES_EXPORT_LOGO_MAX_BYTES = 1_048_576;
/** Longest side the server draws the logo at, in pixels. */
export const MKTG_SLIDES_EXPORT_LOGO_SIDE_PX = 1200;
/** The side the server draws each iconography sample at, in pixels: a 24-unit line icon, placed small on a slide. */
export const MKTG_SLIDES_EXPORT_ICON_SIDE_PX = 240;
/**
 * The bound on one logo render in its child process, in milliseconds: a
 * render that has not answered by then is killed and the image is dropped.
 * A logo at the drawing size renders in tens of milliseconds; the bound is
 * for an input that never finishes.
 */
export const MKTG_SLIDES_EXPORT_LOGO_RENDER_TIMEOUT_MS = 10_000;
/** The most a logo render's child may write back, in bytes: the largest PNG published, as base64, with room for its JSON line. */
export const MKTG_SLIDES_EXPORT_LOGO_RENDER_MAX_OUTPUT_BYTES = 4 * 1_048_576;
/**
 * How many render children may be alive at once, server-wide: one export's
 * own most (after the primary and the symbol, its other three variants draw
 * at once), so a single export is never slowed, and exports that overlap
 * queue their renders instead of each starting a child.
 */
export const MKTG_SLIDES_EXPORT_LOGO_RENDER_MAX_CHILDREN = 3;

/**
 * The logo variants sent beside the primary, in the order the intake's head
 * lines carry them (slides-export 1.1.2 reads them; 1.1.1 ignores lines it
 * does not read): the symbol, the reversed (white) lockup, the one-colour
 * (black) lockup and the reversed symbol.
 */
export const MKTG_SLIDES_EXPORT_LOGO_VARIANTS = ['symbol', 'reversed', 'one_color', 'symbol_reversed'] as const;

/** The form field each variant's URL travels in (`MktgSlidesExportForm`). */
export const MKTG_SLIDES_EXPORT_LOGO_VARIANT_FIELDS = {
  symbol: 'logo_symbol_url',
  reversed: 'logo_reversed_url',
  one_color: 'logo_one_color_url',
  symbol_reversed: 'logo_symbol_reversed_url',
} as const;

/**
 * The form fields the kit's iconography samples travel in, as PNG URLs
 * (`MktgSlidesExportForm`; slides-export 1.1.6 or later reads them, earlier
 * versions ignore head lines they do not read): the eight icons in the
 * tiles' ink (the kit's dark), the eight in white for a dark ground, and
 * the one highlighted icon in the highlight colour. All three are sent, or
 * none. One constant, so a rename agreed with the agent is one line here
 * and the labels below.
 */
export const MKTG_SLIDES_EXPORT_ICON_FIELDS = { dark: 'icon_dark_urls', light: 'icon_light_urls', highlight: 'icon_highlight_url' } as const;

/** The head line each icon field renders to, in the intake's order; the eight URLs of a set on one line, space-separated. */
export const MKTG_SLIDES_EXPORT_ICON_FIELD_LABELS = { dark: 'ICON DARK URLS', light: 'ICON LIGHT URLS', highlight: 'ICON HIGHLIGHT URL' } as const;
/** The separator between the URLs of one icon set on its head line: one space (a URL never holds one). */
export const MKTG_SLIDES_EXPORT_ICON_URL_SEPARATOR = ' ';

/**
 * A runtime error is a failed export only once it has settled: a session can
 * recover from one (a dropped connection retried), so an error counts when
 * nothing came after it beyond the run's own teardown and it is this old.
 */
export const MKTG_SLIDES_EXPORT_ERROR_SETTLE_MS = MKTG_RUN_ERROR_SETTLE_MS;
/** Compatibility alias; the shared reader now requires explicit work or agent text for recovery. */
export const MKTG_SLIDES_EXPORT_ERROR_TEARDOWN_MS = MKTG_RUN_ERROR_TEARDOWN_MS;

/**
 * How an export is polled: every few seconds, for as long as a slow Drive
 * copy can take. `timeoutMs` is the wall-clock bound on the whole wait (the
 * attempts and one interval of slack), so a poll that never answers cannot
 * hold it open; the server finishes the export's record within it too.
 */
export const MKTG_SLIDES_EXPORT_POLL = { intervalMs: 4000, maxAttempts: 120, timeoutMs: 484_000 } as const;

/** Why the deck carries no project logo, as the result says it. */
export const MKTG_SLIDES_EXPORT_LOGO_NOTES = {
  'no-logo': 'The kit has no SVG logo to place, so the deck keeps the template’s logo.',
  'not-drawn': 'The logo could not be drawn as an image, so the deck keeps the template’s logo.',
  'live-text':
    'The logo sets its text in a font the server cannot draw, so the deck keeps the template’s logo. A logo with its text converted to outlines is placed.',
  'not-public':
    'The logo was not applied: this environment has no public address Google can fetch it from. The deck still takes the kit’s colours and typeface.',
  'not-published': 'The logo was not applied: it could not be published for Google to fetch. The deck still takes the kit’s colours and typeface.',
  'not-placed': 'The logo was not applied: Google Slides did not place it. The deck still takes the kit’s colours and typeface.',
} as const;

/** The plain messages a failed export shows; never the agent's own text. */
export const MKTG_SLIDES_EXPORT_FAILURE_MESSAGES = {
  intake: 'The exporter could not read this export, so nothing was created. Try again; if it happens again, open the latest revision and export from there.',
  'not-a-deck':
    'The deck from the last export is no longer a Google Slides presentation (it may have been moved, deleted or converted). Create a new deck instead.',
  partial: 'Google Slides stopped partway through the export, so the deck may be incomplete. Try again.',
  google: 'Google Drive or Slides refused the export. Try again in a moment.',
  unknown: 'The export failed. Try again in a moment.',
  timeout: 'The export is taking longer than expected. It may still finish: check Google Drive, or try again.',
  start: 'The export could not be started. Try again in a moment.',
} as const;

/** Why a start was refused, by the BFF's error code, in plain words. */
export const MKTG_SLIDES_EXPORT_START_MESSAGES: Record<string, string> = {
  NO_DECK_TO_UPDATE: 'There is no earlier deck to update. Create a new deck instead.',
  NOTHING_TO_EXPORT: 'This revision holds nothing that exports to Google Slides.',
  FAMILY_NOTHING_APPROVED: 'This family has no approved assets to export. Approve an asset first.',
  FAMILY_ASSET_UNREADABLE: 'An approved family asset could not be read for Google Slides. Open the asset, check its approved revision and try again.',
  REVISION_NOT_STORED: 'This version is not stored yet, so it cannot be exported. Try again in a moment, or export it from Documents.',
  FORBIDDEN: 'You need write access to this project to export its documents.',
};
