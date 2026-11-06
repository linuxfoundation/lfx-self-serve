// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Export to Google Slides: the exporter's form and result envelope
// (slides-export-output/v1, mirroring marketing-os-agents
// agents/slides-export 1.1.2, src/form.ts and src/envelope.ts; a Brand Kit
// export's chapters need 1.1.0 or later, the logo variants 1.1.2 or later),
// the BFF's routes and the export record a deck is kept with, beside the
// document revision it was made from.

import {
  MKTG_SLIDES_EXPORT_AGENT_KEYS,
  MKTG_SLIDES_EXPORT_ASSET_KINDS,
  MKTG_SLIDES_EXPORT_FAILURE_MESSAGES,
  MKTG_SLIDES_EXPORT_ICON_FIELDS,
  MKTG_SLIDES_EXPORT_LOGO_NOTES,
  MKTG_SLIDES_EXPORT_LOGO_VARIANT_FIELDS,
  MKTG_SLIDES_EXPORT_LOGO_VARIANTS,
  MKTG_SLIDES_EXPORT_MODES,
  MKTG_SLIDES_EXPORT_SLIDE_KINDS,
} from '../constants/mktg-slides-export.constants';
import type { MktgDocumentType } from './mktg-document-store.interface';

/** The documents that export: the Messaging Framework and the Brand Kit. */
export type MktgSlidesExportAgentKey = (typeof MKTG_SLIDES_EXPORT_AGENT_KEYS)[number];

/** `create`: a new deck copied from the LF 2025 template; `update`: the deck of the last export, refreshed in place. */
export type MktgSlidesExportMode = (typeof MKTG_SLIDES_EXPORT_MODES)[number];

/** An asset member of the export. */
export type MktgSlidesExportAssetKind = (typeof MKTG_SLIDES_EXPORT_ASSET_KINDS)[number];

/** A slide's kind, as the envelope lists it. */
export type MktgSlidesExportSlideKind = (typeof MKTG_SLIDES_EXPORT_SLIDE_KINDS)[number];

/** Why a deck carries no project logo; null when it does. */
export type MktgSlidesExportLogoNote = keyof typeof MKTG_SLIDES_EXPORT_LOGO_NOTES;

/** A logo variant sent beside the primary: the symbol, the reversed lockup, the one-colour lockup, the reversed symbol. */
export type MktgSlidesExportLogoVariant = (typeof MKTG_SLIDES_EXPORT_LOGO_VARIANTS)[number];

/** One of the logo images a deck places: the primary, or a variant. */
export type MktgSlidesExportLogoImage = 'primary' | MktgSlidesExportLogoVariant;

/** One image the server publishes for a deck, for the log: a logo image by name, or an icon by set and id (server-side). */
export type MktgSlidesExportPublishedImage = MktgSlidesExportLogoImage | MktgSlidesExportIconImage;

/** How many image requests the exporter sent per logo image (`content.branded.logo_variants`, slides-export 1.1.2); 0 for one not supplied. */
export type MktgSlidesExportLogoVariantCounts = Record<MktgSlidesExportLogoImage, number>;

/** The variant URLs that could be drawn and published, by variant; a variant that could not is absent. */
export type MktgSlidesExportLogoVariantUrls = Partial<Record<MktgSlidesExportLogoVariant, string>>;

/** The form field a variant's URL travels in. */
export type MktgSlidesExportLogoVariantField = (typeof MKTG_SLIDES_EXPORT_LOGO_VARIANT_FIELDS)[MktgSlidesExportLogoVariant];

/** The form's logo fields: the primary and each variant, each present only when its PNG was published. */
export type MktgSlidesExportLogoFields = Pick<MktgSlidesExportForm, 'logo_url' | MktgSlidesExportLogoVariantField>;

/** One of the three icon sets a deck places: the tiles' ink, white, or the one highlighted icon. */
export type MktgSlidesExportIconSet = keyof typeof MKTG_SLIDES_EXPORT_ICON_FIELDS;

/** The form field an icon set's URLs travel in. */
export type MktgSlidesExportIconField = (typeof MKTG_SLIDES_EXPORT_ICON_FIELDS)[MktgSlidesExportIconSet];

/** The form's icon fields: all three present when every icon PNG was published, none otherwise. */
export type MktgSlidesExportIconFields = Pick<MktgSlidesExportForm, MktgSlidesExportIconField>;

/** One icon image the server draws for a deck: which set, and which of the eight icons (server-side). */
export interface MktgSlidesExportIconImage {
  set: MktgSlidesExportIconSet;
  icon: string;
}

/** Why one icon image was not published: the image, the rasterizer's or the publisher's reason, and its detail for the log (server-side). */
export interface MktgSlidesExportIconFailure {
  image: MktgSlidesExportIconImage;
  reason: string;
  detail: string;
}

/** One icon image as the server drew and published it: its public URL, or why there is none (server-side). */
export type MktgSlidesExportIconOutcome = { url: string } | MktgSlidesExportIconFailure;

/** What went wrong with an export, as the plain message names it. */
export type MktgSlidesExportFailure = keyof typeof MKTG_SLIDES_EXPORT_FAILURE_MESSAGES;

/** The exporter's form (`slides_export_form`), rendered into the one text message the agent reads. */
export interface MktgSlidesExportForm {
  project_name: string;
  /** YYYY-MM-DD; today (UTC) when absent. */
  run_date?: string;
  /** The folder a new deck is created in; required without `deck_id`. */
  folder_id?: string;
  /** The deck to update in place. */
  deck_id?: string;
  /** A new deck's title; the agent's default when absent. Ignored on an update. */
  deck_title?: string;
  /** A publicly fetchable PNG, JPEG or GIF URL of the project logo. */
  logo_url?: string;
  /** A publicly fetchable PNG, JPEG or GIF URL of the logo's symbol alone (slides-export 1.1.2 or later). */
  logo_symbol_url?: string;
  /** A publicly fetchable PNG, JPEG or GIF URL of the reversed (white) lockup, for dark grounds (slides-export 1.1.2 or later). */
  logo_reversed_url?: string;
  /** A publicly fetchable PNG, JPEG or GIF URL of the one-colour (black) lockup (slides-export 1.1.2 or later). */
  logo_one_color_url?: string;
  /** A publicly fetchable PNG, JPEG or GIF URL of the reversed (white) symbol alone (slides-export 1.1.2 or later). */
  logo_symbol_reversed_url?: string;
  /** The kit's eight iconography samples in the tiles' ink (the kit's dark), publicly fetchable PNG URLs in the board's order (slides-export 1.1.6 or later). */
  icon_dark_urls?: string[];
  /** The same eight icons in white, for the strip's dark ground; the deck draws the ground and the labels itself (slides-export 1.1.6 or later). */
  icon_light_urls?: string[];
  /** The one highlighted strip icon (the third, Global) in the kit's highlight colour, a publicly fetchable PNG URL (slides-export 1.1.6 or later). */
  icon_highlight_url?: string;
  /** One member per asset, as LFX One stores it. */
  assets: Partial<Record<MktgSlidesExportAssetKind, unknown>>;
}

/** One slide the export built. */
export interface MktgSlidesExportSlide {
  index: number;
  kind: MktgSlidesExportSlideKind;
  layout: string;
  title: string;
  object_id: string;
}

/** What the export branded on the deck's layouts and master. */
export interface MktgSlidesExportBranded {
  kit: boolean;
  logo: boolean;
  backgrounds: number;
  text_colors: number;
  fonts: number;
  bars: number;
  logos: number;
  logos_skipped: number;
  tables_header: string | null;
  /** Per logo image, the requests that placed it; absent before slides-export 1.1.2. */
  logo_variants?: MktgSlidesExportLogoVariantCounts;
}

/** What the deck holds, as the envelope reports it (the bytes `content_sha256` is computed over). */
export interface MktgSlidesExportContent {
  assets: MktgSlidesExportAssetKind[];
  slides: MktgSlidesExportSlide[];
  branded: MktgSlidesExportBranded;
}

/** The exporter's result envelope (slides-export-output/v1). */
export interface MktgSlidesExportEnvelope {
  contract: string;
  kind: string;
  project: string;
  project_name: string;
  mode: MktgSlidesExportMode;
  deck: {
    id: string;
    link: string;
    /** The new deck's title; null on an update. */
    title: string | null;
    /** The folder the new deck went to; null on an update. */
    folder_id: string | null;
  };
  slide_count: number;
  content: MktgSlidesExportContent;
  /** SHA-256 of JSON.stringify(content). */
  content_sha256: string;
  generated_at: string;
  agent: { identifier: string; agent_version: string };
}

export interface MktgSlidesExportValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * One export as LFX One keeps it: the deck, and the document revision it was
 * made from. Immutable and content-addressed; the newest record of a
 * document is its "last export", whose deck an update refreshes. Holds no
 * personal identity.
 */
export interface MktgSlidesExportRecord extends MktgSlidesExportDeckRecord {
  agentKey: MktgSlidesExportAgentKey;
  documentId: string;
  /** The revision exported, its number in Documents, and the hash of its content. */
  revisionId: string;
  revisionNumber: number;
  contentSha256: string;
}

/** Deck metadata shared by document and family export records. */
export interface MktgSlidesExportDeckRecord {
  schema: string;
  /** The SERVER-resolved project uid. */
  project: string;
  mode: MktgSlidesExportMode;
  deckId: string;
  link: string;
  /** The new deck's title; null on an update (the deck keeps its title). */
  title: string | null;
  slideCount: number;
  assets: MktgSlidesExportAssetKind[];
  branded: MktgSlidesExportBranded;
  /** When the exporter finished (the envelope's `generated_at`). */
  exportedAt: string;
  agentVersion: string;
}

/**
 * Select approved current at export start. Explicit mismatching selectors
 * fail with 409; absent selectors use approved current. Result polling loads
 * the already-selected revision without rechecking a changed pointer.
 */
export interface MktgSlidesExportTarget {
  /** The project uid; the BFF resolves it and requires the writer grant. */
  project: string;
  agentKey: MktgSlidesExportAgentKey;
  documentId: string;
  revisionId?: string;
  contentSha256?: string;
}

/** A revision as the export panel compares it with the last export. */
export interface MktgSlidesExportRevisionRef {
  id: string;
  number: number;
  contentSha256: string;
}

/** Body of `POST /api/mktg-agents/slides-export/start`. */
export interface MktgSlidesExportStartRequest extends MktgSlidesExportTarget {
  mode: MktgSlidesExportMode;
}

/** Response of a start: the session to poll, and what was exported. */
export interface MktgSlidesExportStartResponse {
  sessionId: string;
  /** Binds the session to the requester and to the revision it exports. */
  ownerToken: string;
  revision: MktgSlidesExportRevisionRef;
  mode: MktgSlidesExportMode;
  /** Why no logo was sent; null when one was. */
  logoNote: MktgSlidesExportLogoNote | null;
}

/** Body of `POST /api/mktg-agents/slides-export/result`. */
export interface MktgSlidesExportResultRequest extends MktgSlidesExportTarget {
  sessionId: string;
  ownerToken: string;
  /** The revision the start exported (bound into the owner token). */
  revisionId: string;
}

/** Response of a result poll. */
export type MktgSlidesExportResultResponse = MktgSlidesExportPollResponse<MktgSlidesExportRecord>;

/** The same poll states for document and family record scopes. */
export type MktgSlidesExportPollResponse<TRecord extends MktgSlidesExportDeckRecord> =
  | { status: 'pending' }
  | { status: 'ready'; record: TRecord }
  | { status: 'failed'; failure: MktgSlidesExportFailure; message: string; deckLink: string | null };

/** Last export and approved-current identity for freshness comparison, not exported-byte selection. */
export interface MktgSlidesExportLastResponse {
  last: MktgSlidesExportRecord | null;
  latestRevision: MktgSlidesExportRevisionRef | null;
}

/** Where the export panel stands. */
export type MktgSlidesExportPhase = 'idle' | 'choosing' | 'running' | 'done' | 'failed';

/**
 * One step of an export the browser runs (client view model): as soon as it
 * is asked for, its mode with no logo note and no result yet; once started,
 * why no logo was sent (null when one was); then the poll's one result,
 * ready or failed. Every step carries the mode, so a panel that attaches to
 * the export later retries it the same way (Update never becomes Create).
 */
export interface MktgSlidesExportRunUpdate {
  mode: MktgSlidesExportMode;
  logoNote: MktgSlidesExportLogoNote | null;
  result: MktgSlidesExportResultResponse | null;
}

/** What the panel says about a finished export's brand (view model). */
export interface MktgSlidesExportBrandSummary {
  /** e.g. "In the kit's colours and typeface, with the project logo on 9 layouts." */
  text: string;
  /** A note that the logo was not applied, or ''. */
  logoNote: string;
}

/** What the BFF's export service takes to start an export (server-side). */
export interface MktgSlidesExportStartInput {
  /** The SERVER-resolved project uid. */
  project: string;
  projectName: string;
  type: MktgDocumentType;
  agentKey: MktgSlidesExportAgentKey;
  documentId: string;
  selector: { revisionId?: string; contentSha256?: string };
  mode: MktgSlidesExportMode;
}

/**
 * Why the server could not draw the kit's SVG logo as a PNG:
 * `external-reference` — an href that is not a same-document fragment or an
 * embedded image, or an entity declaration that is external, a parameter
 * entity, or carries markup or references; `live-text` — a text element,
 * which the fontless server would draw as nothing; `unreadable` — the SVG
 * does not parse, has no size, or does not draw; `too-big` — the PNG is over
 * the Slides API's limit; `blank` — nothing was painted, when the caller
 * asked for ink (`requireInk`; the variants do, the primary does not);
 * `render-failed` — the render's child process died, overran its bound or
 * answered unreadably (the rasterizer's native code aborts on some
 * geometry, which no in-process catch can hold). The start's note treats
 * `render-failed` as `unreadable`: the logo was not drawn.
 */
export type MktgLogoPngFailure = 'external-reference' | 'live-text' | 'unreadable' | 'too-big' | 'blank' | 'render-failed';

/**
 * How the server draws a logo PNG: `requireInk` refuses a drawing with no painted pixel (`blank`) instead of publishing a
 * transparent image; `sidePx` is the longest side to draw at (the logo's drawing size when absent).
 */
export interface MktgLogoPngOptions {
  requireInk?: boolean;
  sidePx?: number;
}

/** What the server sends its render child on stdin: the rasterizer's resolved path, the SVG, and the rules to draw it by (server-side). */
export interface MktgLogoRenderRequest {
  resvgPath: string;
  svg: string;
  requireInk: boolean;
  sidePx: number;
  maxBytes: number;
}

/** The render child's one JSON line back: the PNG as base64, or why there is none (server-side). */
export type MktgLogoRenderReply = { png: string } | { reason: MktgLogoPngFailure; detail: string };

/** The one colour a logo variant is recoloured to: white for the reversed variants, black for the one-colour lockup. */
export type MktgLogoRecolourInk = 'white' | 'black';

/** The pixel size of a drawn PNG, read from its header (server-side). */
export interface MktgLogoPngSize {
  width: number;
  height: number;
}

/** A logo variant drawn from an SVG as it is: an upload (`derived: false`), or the server's crop of the primary through the shared viewBox helper (`derived: true`) (server-side). */
export interface MktgLogoVariantSvgSource {
  kind: 'svg';
  svg: string;
  derived: boolean;
}

/** A logo variant the server derives by recolouring the drawn PNG of another logo image (the primary, or the symbol) to one ink; always the server's own (server-side). */
export interface MktgLogoVariantRecolourSource {
  kind: 'recolour';
  of: 'primary' | 'symbol';
  ink: MktgLogoRecolourInk;
}

/** What one logo variant is drawn from (server-side). */
export type MktgLogoVariantSource = MktgLogoVariantSvgSource | MktgLogoVariantRecolourSource;

/** What each logo variant is drawn from, by variant; a variant that does not apply to the kit (no symbol) is absent (server-side). */
export type MktgLogoVariantSources = Partial<Record<MktgSlidesExportLogoVariant, MktgLogoVariantSource>>;

/** The PNG of each logo image drawn so far in one export, by image: the bytes, or null when the server tried to draw it and could not (server-side). */
export type MktgLogoDrawnPngs = Partial<Record<MktgSlidesExportLogoImage, Uint8Array | null>>;

/**
 * The kit's SVG logo drawn as a PNG on the server (server-side). `png` is a
 * `Uint8Array` so the contract stays Node-free; the rasterizer returns a
 * `Buffer`. `detail` explains a failure, for the log only: a fixed sentence
 * for a refused SVG (`external-reference`, `live-text`), the parsed size or
 * the rasterizer's own error (`unreadable`), the PNG's byte count
 * (`too-big`), the drawing's size (`blank`), or how the child ended and the
 * tail of what it wrote to stderr (`render-failed`).
 */
export type MktgLogoPngResult = { png: Uint8Array; reason: null } | { png: null; reason: MktgLogoPngFailure; detail: string };

/** What the BFF's export service answers a start with; the controller adds the owner token. */
export interface MktgSlidesExportStarted {
  sessionId: string;
  revision: MktgSlidesExportRevisionRef;
  mode: MktgSlidesExportMode;
  logoNote: MktgSlidesExportLogoNote | null;
}

/**
 * The kit's logo as the BFF published it for a deck (server-side): the
 * primary's public URL, or why there is none (the note the start answers
 * with), and the URL of each variant that could be drawn and published
 * beside it. The variants carry no note: the deck drops the slot of one
 * that is missing (slides-export 1.1.2).
 */
export interface MktgSlidesExportPublishedLogo {
  url: string | null;
  note: MktgSlidesExportLogoNote | null;
  variants: MktgSlidesExportLogoVariantUrls;
}

/** One logo PNG as the BFF published it: its public URL, or why there is none (server-side). */
export type MktgSlidesExportPublishedPng = Omit<MktgSlidesExportPublishedLogo, 'variants'>;

/** Export scope retained by server-side background poll logs. */
export type MktgSlidesExportLogContext = { agent: MktgSlidesExportAgentKey } | { family: string };

/** The revision a result poll keeps the deck with (server-side). */
export interface MktgSlidesExportResultContext {
  /** The SERVER-resolved project uid. */
  project: string;
  type: MktgDocumentType;
  agentKey: MktgSlidesExportAgentKey;
  documentId: string;
  revisionId: string;
}
