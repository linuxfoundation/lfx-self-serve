// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Brand Kit output envelope (brand-kit-output/v2), the draft form contract and
// the questions/answers turns (brand-kit-questions/v1, brand-kit-answers/v1),
// shared between the Express BFF and the Angular run page and kit view.
// Transcribed from marketing-os-agents agents/brand-kit (src/envelope.ts,
// src/form.ts, src/kit.ts, src/questions-turn.ts); the agent's JSON Schema
// (docs/contracts/brand-kit-output.schema.json) is normative and this must
// stay in sync (reviewed at PR).

import {
  BRAND_KIT_ANSWER_KEYS,
  BRAND_KIT_CHAPTERS,
  BRAND_KIT_CONTRAST_GRADES,
  BRAND_KIT_FOUND_IN_KINDS,
  BRAND_KIT_LOGO_FILE_KINDS,
  BRAND_KIT_LOGO_SLOTS,
  BRAND_KIT_MODES,
  BRAND_KIT_REPORT_ASSETS,
  BRAND_KIT_REPORT_RULE_BASES,
  BRAND_KIT_REPORT_SOURCE_KINDS,
  BRAND_KIT_REPORT_V2,
  BRAND_KIT_REPORT_WARNING_CODES,
  BRAND_KIT_TYPE_STEPS,
  BRAND_KIT_WEB_VIEW_TABS,
} from '../constants/brand-kit.constants';
import type { BrandKitIconColours } from './brand-kit-icons.interface';
import type { MktgArtifactPersistReceipt, MktgArtifactStoredResponse } from './mktg-artifact.interface';
import type { MktgAssetReport } from './mktg-asset.interface';
import type {
  MktgIntakeLogoFile,
  MktgRunAnswer,
  MktgRunAnswersBody,
  MktgRunAnswersResponse,
  MktgRunGenerateBody,
  MktgRunResultBody,
  MktgRunResultResponse,
  MktgRunSessionResponse,
} from './mktg-run.interface';

/** What produced a revision: a draft, a redraft from reviewer comments, or a check of a hand-edited kit. */
export type BrandKitMode = (typeof BRAND_KIT_MODES)[number];

/** One of the four gap keys. */
export type BrandKitAnswerKey = (typeof BRAND_KIT_ANSWER_KEYS)[number];

/** A WCAG grade of the contrast table. */
export type BrandKitContrastGrade = (typeof BRAND_KIT_CONTRAST_GRADES)[number];

/** Where a palette value was found and checked. */
export type BrandKitFoundInKind = (typeof BRAND_KIT_FOUND_IN_KINDS)[number];

/** A step of the type scale. */
export type BrandKitTypeStepId = (typeof BRAND_KIT_TYPE_STEPS)[number];

/** The kind of a logo file by its name; `other` for anything the agent cannot decode. */
export type BrandKitLogoFileKind = (typeof BRAND_KIT_LOGO_FILE_KINDS)[number] | 'other';

/** One of the four logo slots. */
export type BrandKitLogoSlot = (typeof BRAND_KIT_LOGO_SLOTS)[number];

/** One tab of the kit's web view. */
export type BrandKitWebViewTabId = (typeof BRAND_KIT_WEB_VIEW_TABS)[number]['id'];

/** One of the six chapters. */
export type BrandKitChapterId = (typeof BRAND_KIT_CHAPTERS)[number]['id'];

// ---------------------------------------------------------------------------
// The kit tokens and the six chapters
// ---------------------------------------------------------------------------

/** One colour token: name, `#RRGGBB`, role. */
export type BrandKitColorToken = [string, string, string];

/** One voice attribute token: the attribute and how it shows up in copy. */
export type BrandKitAttrToken = [string, string];

/** The brand-kit skill's tokens, verbatim shape — what its book renderer reads. */
export interface BrandKitTokens {
  /** Four or five colours, in order: the primary dark, white (or the light ground), then the accents. */
  colors: BrandKitColorToken[];
  font: string;
  fontNote: string;
  /** Exactly four attributes. */
  attrs: BrandKitAttrToken[];
  /** The primary dark. */
  dark: string;
  /** The one accent. */
  accent: string;
  /** The spark colour. */
  spark: string;
  /** The wordmark in capitals. */
  word: string;
}

/** A logo file of the run: `ref` is the file name, `<zip>/<entry>`, or the URL of an SVG the agent fetched; `svg` is the source text when it is an SVG. */
export interface BrandKitLogoRef {
  ref: string;
  svg: string | null;
}

/** The real logo files, assigned to their slots; null where none was supplied. */
export type BrandKitLogoFiles = Record<BrandKitLogoSlot, BrandKitLogoRef | null>;

/** One of the four colorways. */
export interface BrandKitColorway {
  name: string;
  ground: string;
  logo: string;
}

export interface BrandKitMinimumSize {
  screen_px: number;
  print_mm: number;
  symbol_px: number;
  rule: string;
}

/** Chapter 1 — the logo. */
export interface BrandKitLogoChapter {
  files: BrandKitLogoFiles;
  /** An SVG viewBox that crops the symbol out of the primary lockup, or null. */
  symbol_viewbox: string | null;
  /** True when no logo artwork exists: the book draws placeholder marks until the files are uploaded. */
  placeholder: boolean;
  system: string;
  colorways: BrandKitColorway[];
  clear_space: string;
  minimum_size: BrandKitMinimumSize;
  symbol: string;
  partnership: string[];
  watchouts: string[];
}

/** One palette entry with its provenance. */
export interface BrandKitPaletteEntry {
  name: string;
  hex: string;
  rgb: [number, number, number];
  role: string;
  found_in: { kind: BrandKitFoundInKind; source: string };
}

export interface BrandKitProportionRow {
  name: string;
  hex: string;
  /** Percentage share, the rows sum to 100. */
  share: number;
}

/** One row of the WCAG contrast table. */
export interface BrandKitContrastRow {
  foreground: string;
  background: string;
  /** WCAG contrast ratio, two decimals. */
  ratio: number;
  grade: BrandKitContrastGrade;
}

/** Chapter 2 — colour. */
export interface BrandKitColorChapter {
  summary: string;
  palette: BrandKitPaletteEntry[];
  proportion: BrandKitProportionRow[];
  contrast: { rule: string; pairs: BrandKitContrastRow[] };
}

export interface BrandKitTypeStep {
  step: BrandKitTypeStepId;
  label: string;
  weight: number;
  size: number;
  line_height: number;
  caps: boolean;
}

/** Chapter 3 — type. */
export interface BrandKitTypeChapter {
  family: string;
  weights: number[];
  source: string;
  google_fonts: boolean;
  fallback: string | null;
  note: string;
  summary: string;
  scale: BrandKitTypeStep[];
  rules: string[];
}

/** Chapter 4 — visual. */
export interface BrandKitVisualChapter {
  icons: { rules: string[]; recommended: string };
  imagery: { rule: string; avoid: string[] };
}

export interface BrandKitUsageExample {
  name: string;
  format: string;
  ground: string;
}

/** Chapter 5 — usage. */
export interface BrandKitUsageChapter {
  summary: string;
  examples: BrandKitUsageExample[];
}

export interface BrandKitVoiceAttribute {
  name: string;
  line: string;
}

/** Chapter 6 — voice in brief. */
export interface BrandKitVoiceChapter {
  umbrella: string;
  line: string;
  /** "From the messaging framework" or "Drafted from the site (provisional until a messaging framework is approved)". */
  source: string;
  note: string;
  attributes: BrandKitVoiceAttribute[];
}

/** The six chapters of the reference kit, every value computed or validated by the agent wrapper. */
export interface BrandKitChapters {
  logo: BrandKitLogoChapter;
  color: BrandKitColorChapter;
  type: BrandKitTypeChapter;
  visual: BrandKitVisualChapter;
  usage: BrandKitUsageChapter;
  voice: BrandKitVoiceChapter;
}

/** What a failed source was. */
export type BrandKitReportSourceKind = (typeof BRAND_KIT_REPORT_SOURCE_KINDS)[number];
/** An asset the agent may report missing. */
export type BrandKitReportAsset = (typeof BRAND_KIT_REPORT_ASSETS)[number];
/** A warning the agent may raise. */
export type BrandKitReportWarningCode = (typeof BRAND_KIT_REPORT_WARNING_CODES)[number];
/** Where a rendered rule comes from. */
export type BrandKitReportRuleBasis = (typeof BRAND_KIT_REPORT_RULE_BASES)[number];

/** A source the agent could not read, in plain language; `detail` keeps the machine reason. */
export interface BrandKitReportFailedSource {
  source: string;
  kind: BrandKitReportSourceKind;
  reason: string;
  detail?: string;
}

/** An asset the agent looked for and did not find, with the plain reason and, when it knows one, the fix. */
export interface BrandKitReportMissingAsset {
  asset: BrandKitReportAsset;
  reason: string;
  fix?: string;
}

/** Something the agent noticed about what it read; `source` names where. */
export interface BrandKitReportWarning {
  code: BrandKitReportWarningCode;
  text: string;
  source?: string;
}

/** One palette colour seen with different values in different sources; `chosen` is the hex the kit keeps. */
export interface BrandKitReportColorConflict {
  name: string;
  values: { hex: string; source: string }[];
  chosen: string;
}

/** The basis of one rule string the chapters render, by its path in the envelope. */
export interface BrandKitReportRule {
  path: string;
  basis: BrandKitReportRuleBasis;
  uses?: string[];
}

/** How many of a chapter's rendered rules come from the project's own sources and how many from the LF reference kit (report v2). */
export interface BrandKitChapterRuleBasis {
  id: BrandKitChapterId;
  /** The chapter's title as the kit names it (`Logo`). */
  title: string;
  total: number;
  project: number;
  lfReference: number;
}

/** One value of a colour conflict as the approve dialog shows it: the hex, where it was found in words, and whether the kit kept it. */
export interface BrandKitColorConflictValueView {
  hex: string;
  source: string;
  kept: boolean;
}

/** One colour conflict as the approve dialog shows it. */
export interface BrandKitColorConflictView {
  name: string;
  values: BrandKitColorConflictValueView[];
  /** The hex the kit keeps. */
  chosen: string;
}

/** One line of the approve dialog's LF-reference rules: a chapter and how many of its rules the reference supplied. */
export interface BrandKitLfReferenceRuleLine {
  id: BrandKitChapterId;
  /** `Logo: 20 of 21 rules`. */
  text: string;
}

/** A failed source as the approve dialog lists it: the source, the agent's plain reason and, when it gives one, the machine detail. */
export interface BrandKitApproveFailedItem {
  title: string;
  text: string;
  detail: string | null;
}

/** A missing asset as the approve dialog lists it: the asset's label, the agent's plain reason and, when it names one, the fix. */
export interface BrandKitApproveMissingItem {
  title: string;
  text: string;
  fix: string | null;
}

/** What a v2 report's approve dialog lists first, in the Sources tab's words; both empty for a v1 report. */
export interface BrandKitApproveFindings {
  failed: BrandKitApproveFailedItem[];
  missing: BrandKitApproveMissingItem[];
}

/** The three findings groups of a v2 report, written by the agent in plain language; the UI never rewrites a reason. */
export interface BrandKitReportFindings {
  sources_failed: BrandKitReportFailedSource[];
  missing_assets: BrandKitReportMissingAsset[];
  warnings: BrandKitReportWarning[];
}

/** One line of a Sources tab group, with whether the current approval accepted it. */
export interface BrandKitSourcesItem {
  /** The stable key the approval snapshot stores. */
  key: string;
  title: string;
  text: string;
  /** Small grey text under the line (a failed source's machine detail). */
  detail: string | null;
  /** A second line, "Fix: …", when the agent names one. */
  fix: string | null;
  /** Where a warning was seen, shown as text; for a failed source, its full address when the title is a name for it. */
  source: string | null;
  /** The source as a link, only when it is an http(s) address; anything else stays text. */
  href: string | null;
  accepted: boolean;
}

/** One value of a conflicting colour, drawn as the Colour chapter draws a swatch: the hex on its own ground, in a legible ink. */
export interface BrandKitSourcesConflictValue {
  hex: string;
  /** The hex without its `#`, for the swatch's testid as the Colour chapter writes it. */
  hexDigits: string;
  /** Where the value was seen, as the agent wrote it. */
  source: string;
  /** The same in words, as the palette names its provenance (`From the brand page — example.org`). */
  sourceLabel: string;
  /** A light colour needs a border to stand off the white card. */
  light: boolean;
  ink: string;
}

/** One colour seen with different values; the swatches in the order the agent gave. */
export interface BrandKitSourcesConflict {
  key: string;
  name: string;
  values: BrandKitSourcesConflictValue[];
  chosen: string;
  accepted: boolean;
}

/** The Sources tab as rendered: the four groups, the gaps with their markers, and the marker text. */
export interface BrandKitSourcesView {
  failed: BrandKitSourcesItem[];
  missing: BrandKitSourcesItem[];
  warnings: BrandKitSourcesItem[];
  conflicts: BrandKitSourcesConflict[];
  gaps: { text: string; accepted: boolean }[];
  /** "Accepted when vN was approved" once the approval carries a snapshot; empty otherwise. */
  acceptedMarker: string;
  /** True when the current approval has no snapshot: the view falls back to the derived gaps line. */
  legacyApproval: boolean;
}

/**
 * The skill's report: shown to the reviewer, never stored as content. The v1 fields are always there; the v2 fields
 * (brand-kit ≥ 2.2.0) are optional. A v1 report shows its legacy sources_failed list under Failed sources, and the
 * v2 groups show their empty lines.
 */
export interface BrandKitReport extends MktgAssetReport {
  version?: typeof BRAND_KIT_REPORT_V2;
  findings?: BrandKitReportFindings;
  color_conflicts?: BrandKitReportColorConflict[];
  rules?: BrandKitReportRule[];
}

/** One logo file of the inputs record. */
export interface BrandKitInputLogoFile {
  name: string;
  kind: string;
  bytes: number;
  colors: string[];
  error?: string;
}

/** One question the run asked, as the inputs record keeps it. */
export interface BrandKitInputQuestion {
  key: BrandKitAnswerKey;
  why: string;
  suggested_answer: string;
  basis: string;
  answered: boolean;
}

/** One answer the run received, as the inputs record keeps it. */
export interface BrandKitInputAnswer {
  key: BrandKitAnswerKey;
  origin: MktgRunAnswer['origin'];
  text: string;
}

/** The run's inputs record: what was given, inspected, read, searched, asked and answered. Open for additive growth. */
export interface BrandKitInputsRecord {
  website_url: string | null;
  brand_page_url: string | null;
  framework_supplied: boolean;
  logo_files: BrandKitInputLogoFile[];
  questions_asked: BrandKitInputQuestion[];
  answers: BrandKitInputAnswer[];
  web_searches: string[];
  fetched: { url: string; ok: boolean }[];
  lfx_records: { slug: string; uid: string; name: string }[];
  [key: string]: unknown;
}

/** A reviewer comment a redraft applied, with its resolution. */
export interface BrandKitRevisionComment {
  number: number;
  passage: string;
  comment: string;
  resolution: string;
}

/** Producer provenance, filled deterministically by the agent wrapper. */
export interface BrandKitAgentProvenance {
  /** Guild agent identifier (owner~name). */
  identifier: string;
  /** Published agent version that produced the kit (semver). */
  agent_version: string;
  /** SHA-256 of the agent's pinned manifest (the spec of record this build was made against). */
  prompt_manifest_sha256: string;
}

/**
 * The Brand Kit output envelope — the typed output of the
 * linux-foundation~brand-kit agent (the finalize tool's `envelope_json`) and
 * the exact payload the BFF validates (schema gates and the sha256 recompute)
 * before storing it as a revision. The kit is in it three ways: the tokens,
 * the chapters, and the Markdown the chapters render to.
 */
export interface BrandKitEnvelope {
  /** Contract discriminator + version; consumers reject unknown majors. */
  contract: string;
  /** Always `brand-kit`. */
  kind: string;
  /** Project slug (lowercase kebab-case) of `project_name`. */
  project: string;
  /** The project's name exactly as the form gave it. */
  project_name: string;
  /** 1 for a draft; the stored revision + 1 for a redraft or a check. */
  version: number;
  mode: BrandKitMode;
  /** The kit rendered as Markdown by the agent wrapper from `chapters`. */
  document_markdown: string;
  /** Lowercase hex SHA-256 of the UTF-8 bytes of document_markdown. */
  content_sha256: string;
  kit: BrandKitTokens;
  chapters: BrandKitChapters;
  report: BrandKitReport;
  inputs: BrandKitInputsRecord;
  /** Always the rendered LFX One form (dec-qa-form-path-only). */
  intake: { mode: 'form'; completed_at: string };
  /** Null on a draft; the stored revision and the comments on a redraft (none on a check). */
  revision: { prior_version: number; comments: BrandKitRevisionComment[] } | null;
  /** Null unless mode is check. */
  check: { fixes: string[]; issues: string[] } | null;
  capabilities: { web_fetch: boolean; lfx_mcp: boolean };
  /** ISO-8601 timestamp when the kit was emitted. */
  generated_at: string;
  agent: BrandKitAgentProvenance;
}

// ---------------------------------------------------------------------------
// The draft form
// ---------------------------------------------------------------------------

/** One uploaded logo file as the agent's form takes it: its name and exactly one of SVG text, base64 bytes or a link the agent fetches. */
export type BrandKitLogoFile = MktgIntakeLogoFile;

/**
 * The agent's `brand_kit_intake_form` — what the BFF renders into the one
 * text message it sends (src/form.ts). The site and the brand page travel as
 * URLs: the agent reads them itself. Every text passes through verbatim.
 */
export interface BrandKitFormPayload {
  type: 'brand_kit_intake_form';
  project_name: string;
  /** The run date, YYYY-MM-DD; the renderer defaults it to today (UTC). */
  run_date?: string;
  /** The LFX project uid, for the agent's own LFX lookups. */
  project_uid?: string;
  website_url: string;
  brand_page_url?: string;
  logo_files?: BrandKitLogoFile[];
  notes?: string;
  /** The messaging framework (the envelope or its content), when one exists; the voice chapter's umbrella message and brand line come from it verbatim. A run without it is refused up front (2.1.0). */
  messaging_framework?: Record<string, unknown>;
}

/** Agent's separate revise form; UI exposes only comment-driven redraft, not check. */
export interface BrandKitRedraftFormPayload {
  type: 'brand_kit_revise_form';
  project_name: string;
  run_date?: string;
  project_uid?: string;
  prior_version: number;
  revision_mode: 'redraft';
  kit: BrandKitTokens;
  chapters?: BrandKitChapters;
  website_url?: string;
  brand_page_url?: string;
  logo_files?: BrandKitLogoFile[];
  /** Required by the agent even though its schema permits an omitted framework. */
  messaging_framework: Record<string, unknown>;
  comments: { passage: string; comment: string }[];
}

/** What the BFF layers onto the validated answers to build the form. */
export interface BrandKitFormInputs {
  /** The uploaded logo files, as the agent takes them. */
  logoFiles?: BrandKitLogoFile[];
  /** The LFX project uid the run belongs to. */
  projectUid?: string;
  /** The run date, YYYY-MM-DD; the renderer defaults it to today (UTC). */
  runDate?: string;
}

// ---------------------------------------------------------------------------
// The question round
// ---------------------------------------------------------------------------

/**
 * One question of the agent's questions turn (brand-kit-questions/v1) — a gap
 * the artwork, the site and the framework left open, with the agent's best
 * guess. Field names mirror the agent's JSON block verbatim.
 */
export interface BrandKitQuestion {
  key: BrandKitAnswerKey;
  label: string;
  question: string;
  /** One sentence: what was inspected or read and what it lacked. */
  why: string;
  /** Drafted from the research; empty when nothing can be suggested. */
  suggested_answer: string;
  /** The URL(s) or file(s) the suggestion rests on, 'inferred', or empty. */
  basis: string;
}

/** The agent's questions block: the fenced JSON of the questions turn. */
export interface BrandKitQuestionsBlock {
  /** Always `brand-kit-questions/v1`. */
  contract: string;
  /** The project name as on the form. */
  project: string;
  /** The gap questions, in the fixed order. */
  questions: BrandKitQuestion[];
}

// ---------------------------------------------------------------------------
// What the page renders and what the endpoints exchange
// ---------------------------------------------------------------------------

/**
 * The kit of one revision as the kit view renders it: the tokens, the six
 * chapters and the report, with the run's provenance. Built from a validated
 * envelope on the BFF (`brandKitRevisionOf`), stored with the run's version in
 * the browser, and read back from a stored revision's sidecar in the
 * Documents area (`readBrandKitRevision`).
 */
export interface BrandKitRevision {
  projectName: string;
  /** Project slug from the envelope. */
  project: string;
  version: number;
  mode: BrandKitMode;
  kit: BrandKitTokens;
  chapters: BrandKitChapters;
  report: BrandKitReport;
  /** The site the kit was read from, when the form gave one. */
  websiteUrl: string | null;
  /** ISO-8601 timestamp when the kit was emitted. */
  generatedAt: string;
  /** The agent version that produced it. */
  agentVersion: string;
}

/** One page of the book as the kit view lays it out. */
export interface BrandKitBookPage {
  id: string;
  /** Page number, 1-based (the cover is 1). */
  number: number;
  /** The chapter's running head, e.g. `01 Logo`; '' on the cover and back cover. */
  chapterHead: string;
  title: string;
}

/** A logo as a page draws it: the image source, or the placeholder text when there is no artwork. */
export interface BrandKitLogoImage {
  /** The file reference (a name, `<zip>/<entry>` or a URL): never shown — `name` is. */
  ref: string;
  /** The file as a reader knows it, for the caption and the alt text: its own name, or "the logo you supplied" when that name is an opaque hash. */
  name: string;
  /** A data URL of the SVG, or null when the file is not an SVG (a PNG or a ZIP member the envelope carries no bytes for) or there is no file. */
  src: string | null;
}

/** One colorway tile of the book: the ground it sits on and how the logo is drawn on it. */
export interface BrandKitColorwayTile {
  name: string;
  /** CSS colour of the tile. */
  ground: string;
  /** True when the tile is white or light and needs a hairline border. */
  light: boolean;
  /** The artwork drawn on the tile: the supplied reversed file on the reversed tile when there is one, else the primary lockup. */
  logo: BrandKitLogoImage | null;
  /** CSS filter drawing the primary lockup reversed (white) or one-colour black; '' for full colour or supplied reversed artwork. */
  logoFilter: string;
  /** CSS filter for the symbol on this tile: the symbol is never the supplied reversed lockup, so it keeps the tile's reversal or one-colour filter. */
  symbolFilter: string;
}

/** One palette card of the book. */
export interface BrandKitPaletteCard {
  name: string;
  hex: string;
  /** The hex without its `#` (`4D4E4E`): what names the swatch's test id. */
  hexDigits: string;
  /** `77 78 78`. */
  rgb: string;
  role: string;
  /** Where the value was found, in words, with its source. */
  source: string;
  /** True when the swatch is light and needs a border to stand off a white ground. */
  light: boolean;
  /** The colour the swatch's name is set in on it: one that reaches WCAG AA there (`brandKitLabelInk`). */
  ink: string;
}

/** One row of the book's contrast table, with the colours to draw the sample. */
export interface BrandKitContrastView {
  foreground: string;
  background: string;
  foregroundHex: string;
  backgroundHex: string;
  /** `8.3:1`. */
  ratio: string;
  grade: BrandKitContrastGrade;
  /** True when the pair passes for body text (AA or better). */
  passes: boolean;
}

/** One weight sample of the typography page. */
export interface BrandKitWeightView {
  weight: number;
  /** `Light 300`. */
  label: string;
}

/** One row of the type scale, with the CSS that draws it on the page. */
export interface BrandKitTypeScaleView {
  label: string;
  /** `500 · 64/72`, with `caps` when the step is set in capitals. */
  spec: string;
  sample: string;
  fontWeight: number;
  /** The size in container-width units, so the page scales with its box. */
  fontSize: string;
  lineHeight: string;
  textTransform: string;
  letterSpacing: string;
}

/** One watchout tile: the rule and the illustrative distortion the tile draws. */
/** The distortion a watchout tile shows, in the mock's order: the print keys its own draw by it, never by the screen's CSS. */
export type BrandKitWatchoutKind = 'stretched' | 'recolored' | 'rotated' | 'shadowed' | 'busy' | 'retyped';

export interface BrandKitWatchoutView {
  label: string;
  /** The distortion the tile shows. */
  kind: BrandKitWatchoutKind;
  /** CSS transform applied to the logo, '' for none. */
  transform: string;
  /** CSS filter applied to the logo, '' for none. */
  filter: string;
  /** CSS background of the tile, '' for white. */
  ground: string;
  /** True when the tile shows the wordmark retyped in the kit's type instead of the artwork. */
  retyped: boolean;
}

/** One usage example tile. */
export interface BrandKitUsageView {
  /** `keynote`, `social`, `report` or `announcement`: picks the tile's layout. */
  layout: 'keynote' | 'social' | 'report' | 'announcement';
  /** `Keynote slide · 16:9`. */
  caption: string;
  dark: boolean;
}

/** One chapter as the web view's overview summarises it, with the tab that opens it. */
export interface BrandKitChapterSummary {
  id: BrandKitWebViewTabId;
  /** `01`. */
  number: string;
  title: string;
  summary: string;
}

/** One tab of the kit's web view, with its ARIA ids and classes. */
export interface BrandKitWebViewTab {
  id: BrandKitWebViewTabId;
  label: string;
  selected: boolean;
  tabClass: string;
  tabId: string;
  panelId: string;
}

/**
 * The book as the kit view lays it out: every string and colour the 16 pages
 * bind, computed once from the kit so the template binds properties only.
 */
export interface BrandKitBookView {
  projectName: string;
  /** The project name in capitals, for the covers' eyebrows. */
  projectCaps: string;
  /** The site's host (`jupyterfoundation.org`), '' when the kit names none. */
  host: string;
  /** `V1.0`. */
  versionLabel: string;
  /** `October 2026`, '' when the kit carries no timestamp. */
  monthYear: string;
  /** The running head of every chapter page: `Jupyter Foundation Brand Kit`. */
  runningHead: string;
  /** The footer of every chapter page: `Jupyter Foundation · a Linux Foundation project`. */
  footer: string;
  /** The primary dark, the accent, the spark (the kit's secondary accent), the light tint and the light gray (or the tint again), as CSS colours. */
  dark: string;
  accent: string;
  spark: string;
  tint: string;
  lightGray: string;
  /** The names the kit gives the dark and the accent, for the colorway captions and the prose. */
  darkName: string;
  accentName: string;
  /** The CSS font stack the book sets, and the Google Fonts stylesheet to load (null when the family is not there). */
  fontStack: string;
  fontUrl: string | null;
  pages: BrandKitBookPage[];
  /** The contents page's rows: pages 3 to 16. */
  contents: { number: string; title: string }[];
  /** The contents page's note on what the kit was built from. */
  builtFrom: string;
  logos: Record<BrandKitLogoSlot, BrandKitLogoImage | null>;
  /** The symbol as drawn: the symbol file, or the primary lockup cropped to the symbol. */
  symbol: BrandKitLogoImage | null;
  placeholder: boolean;
  logo: BrandKitLogoChapter;
  colorways: BrandKitColorwayTile[];
  minimumSizes: { label: string; px: number }[];
  watchouts: BrandKitWatchoutView[];
  color: BrandKitColorChapter;
  palette: BrandKitPaletteCard[];
  proportion: BrandKitProportionRow[];
  contrast: BrandKitContrastView[];
  type: BrandKitTypeChapter;
  weights: BrandKitWeightView[];
  scale: BrandKitTypeScaleView[];
  /** The alphabet line. */
  specimen: string;
  visual: BrandKitVisualChapter;
  /** The colours the Visual chapter's iconography samples take from the kit (`brandKitIconColours`). */
  iconColours: BrandKitIconColours;
  usage: BrandKitUsageChapter;
  usageTiles: BrandKitUsageView[];
  voice: BrandKitVoiceChapter;
  /** The back cover's trademark line, for this project. */
  backCoverNotice: string;
  report: BrandKitReport;
}

/** Request body for `POST /api/mktg-agents/brand-kit/generate` — the form answers plus the uploaded logo files. */
export type BrandKitGenerateRequest = MktgRunGenerateBody;

/** Response of `POST /api/mktg-agents/brand-kit/generate` — the session to poll. */
export type BrandKitGenerateResponse = MktgRunSessionResponse;

/** Request body for `POST /api/mktg-agents/brand-kit/answers` — the answers to the session's questions turn. */
export type BrandKitAnswersRequest = MktgRunAnswersBody;

/** Response of `POST /api/mktg-agents/brand-kit/answers`. */
export type BrandKitAnswersResponse = MktgRunAnswersResponse;

/** Request body for `POST /api/mktg-agents/brand-kit/result` — the token travels in the body (never the query string). */
export type BrandKitResultRequest = MktgRunResultBody;

/** Receipt of a successful persistence write (`brand-kit/{project}/{content_sha256}.md`). */
export type BrandKitPersistReceipt = MktgArtifactPersistReceipt;

/** Stored approved-current kit bytes; only true pre-revision plain fallback remains. */
export type BrandKitStoredResponse = MktgArtifactStoredResponse;

/**
 * Response of `POST /api/mktg-agents/brand-kit/result`: `ready` once the
 * session holds a schema-valid, sha256-verified envelope, with the kit the
 * page renders (`brandKit`), the Markdown rendering the store and the sibling
 * agents read, and, when the write succeeded, the persistence receipt of the
 * stored revision; `questions` whenever the session holds a questions block
 * the agent wrote and no valid envelope yet; `refused` when the agent ended
 * the session with its refusal reply instead of running (no messaging
 * framework, or a JSON that is not one); `pending` otherwise. The agent's
 * live activity rides every status.
 */
export interface BrandKitResultResponse extends MktgRunResultResponse {
  /** Project display name from the envelope. Present when ready. */
  projectName?: string;
  /** Project slug from the envelope. Present when ready. */
  project?: string;
  /** Persistence receipt; absent on a ready result when the write did not happen (retried on the next poll). */
  persistence?: BrandKitPersistReceipt;
}

/** Structured result of validating a candidate envelope or a request body. */
export interface BrandKitValidationResult {
  /** True when every gate passed. */
  valid: boolean;
  /** Machine-readable failure reasons (empty when valid). */
  errors: string[];
}
