// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Export to Google Slides: the exporter's form and result envelope
// (slides-export-output/v1, mirroring marketing-os-agents
// agents/slides-export 1.1.0, src/form.ts and src/envelope.ts; a Brand Kit
// export's chapters need 1.1.0 or later), the BFF's routes and the export
// record a deck is kept with, beside the document revision it was made from.

import {
  MKTG_SLIDES_EXPORT_AGENT_KEYS,
  MKTG_SLIDES_EXPORT_ASSET_KINDS,
  MKTG_SLIDES_EXPORT_FAILURE_MESSAGES,
  MKTG_SLIDES_EXPORT_LOGO_NOTES,
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
export interface MktgSlidesExportRecord {
  schema: string;
  /** The SERVER-resolved project uid. */
  project: string;
  agentKey: MktgSlidesExportAgentKey;
  documentId: string;
  /** The revision exported, its number in Documents, and the hash of its content. */
  revisionId: string;
  revisionNumber: number;
  contentSha256: string;
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
 * Which stored revision to export. Documents names the revision on screen;
 * the run page names its version by the hash of its stored content; with
 * neither, the document's latest revision.
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
export type MktgSlidesExportResultResponse =
  | { status: 'pending' }
  | { status: 'ready'; record: MktgSlidesExportRecord }
  | { status: 'failed'; failure: MktgSlidesExportFailure; message: string; deckLink: string | null };

/** Response of `GET /api/mktg-agents/slides-export/last`: the document's last export and its latest revision. */
export interface MktgSlidesExportLastResponse {
  last: MktgSlidesExportRecord | null;
  latestRevision: MktgSlidesExportRevisionRef | null;
}

/** Where the export panel stands. */
export type MktgSlidesExportPhase = 'idle' | 'choosing' | 'running' | 'done' | 'failed';

/**
 * One step of an export the browser runs (client view model): once started,
 * why no logo was sent (null when one was) and no result yet; then the
 * poll's one result, ready or failed.
 */
export interface MktgSlidesExportRunUpdate {
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
 * the Slides API's limit.
 */
export type MktgLogoPngFailure = 'external-reference' | 'live-text' | 'unreadable' | 'too-big';

/**
 * The kit's SVG logo drawn as a PNG on the server (server-side). `png` is a
 * `Uint8Array` so the contract stays Node-free; the rasterizer returns a
 * `Buffer`. `detail` explains a failure, for the log only: a fixed sentence
 * for a refused SVG (`external-reference`, `live-text`), the parsed size or
 * the rasterizer's own error (`unreadable`), or the PNG's byte count
 * (`too-big`).
 */
export type MktgLogoPngResult = { png: Uint8Array; reason: null } | { png: null; reason: MktgLogoPngFailure; detail: string };

/** What the BFF's export service answers a start with; the controller adds the owner token. */
export interface MktgSlidesExportStarted {
  sessionId: string;
  revision: MktgSlidesExportRevisionRef;
  mode: MktgSlidesExportMode;
  logoNote: MktgSlidesExportLogoNote | null;
}

/** The revision a result poll keeps the deck with (server-side). */
export interface MktgSlidesExportResultContext {
  /** The SERVER-resolved project uid. */
  project: string;
  type: MktgDocumentType;
  agentKey: MktgSlidesExportAgentKey;
  documentId: string;
  revisionId: string;
}
