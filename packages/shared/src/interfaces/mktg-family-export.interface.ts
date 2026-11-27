// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MKTG_FAMILY_EXPORT_ACTIVE, MKTG_FAMILY_EXPORT_KINDS, MKTG_FAMILY_EXPORT_MARKER_SCHEMA } from '../constants/mktg-family-export.constants';
import type { MktgDocumentType, MktgRevisionApproval, MktgStoredRevision } from './mktg-document-store.interface';
import type { BrandKitBookView } from './brand-kit.interface';
import type { MktgFamilyPrintConflict, MktgFamilyPrintDocument } from './mktg-family-print.interface';
import type { BoilerplatesPrintView, FaqPrintView, FoundationMessagePrintView, MktgPrintBrand } from './mktg-print.interface';
import type {
  MktgSlidesExportDeckRecord,
  MktgSlidesExportEnvelope,
  MktgSlidesExportLogoNote,
  MktgSlidesExportMode,
  MktgSlidesExportPollResponse,
  MktgSlidesExportResultResponse,
} from './mktg-slides-export.interface';

export type MktgFamilyExportAgentKey = keyof typeof MKTG_FAMILY_EXPORT_KINDS;
/** What a member is to the family's book (framework, kit, boilerplates, FAQ): the kind its reader and its pages go by. */
export type MktgFamilyExportKind = (typeof MKTG_FAMILY_EXPORT_KINDS)[MktgFamilyExportAgentKey];

export interface MktgFamilyExportTarget {
  project: string;
  familyId: string;
}

/** Exact approved-current identity; no names or mutable approval annotations. */
export interface MktgFamilyExportMember {
  agentKey: MktgFamilyExportAgentKey;
  documentId: string;
  revisionId: string;
  revisionNumber: number;
  contentSha256: string;
}

export interface MktgFamilyExportRecord extends MktgSlidesExportDeckRecord {
  familyId: string;
  members: MktgFamilyExportMember[];
}

export interface MktgFamilyExportStartRequest extends MktgFamilyExportTarget {
  mode: MktgSlidesExportMode;
}

/** Signed result context. Polls use these identities, never newly selected current pointers. */
export interface MktgFamilyExportSnapshot extends MktgFamilyExportStartRequest {
  members: MktgFamilyExportMember[];
  /** Server-selected last deck on update; null on create. Bound into the owner token. */
  deckId: string | null;
}

export interface MktgFamilyExportStarted {
  sessionId: string;
  snapshot: MktgFamilyExportSnapshot;
  skippedMembers: MktgFamilyExportAgentKey[];
  logoNote: MktgSlidesExportLogoNote | null;
}

export interface MktgFamilyExportStartResponse extends MktgFamilyExportStarted {
  ownerToken: string;
}

export interface MktgFamilyExportResultRequest extends MktgFamilyExportTarget {
  sessionId: string;
  ownerToken: string;
  snapshot: MktgFamilyExportSnapshot;
}

export type MktgFamilyExportResultResponse = MktgSlidesExportPollResponse<MktgFamilyExportRecord>;

/** The export that holds the family now, as a card shows it: display facts only, never a subject, a Guild session id or an owner capability. */
export interface MktgFamilyExportRunning {
  /** The starter's display name; null when the directory has none (the card then names nobody in particular). */
  startedBy: string | null;
  /** Whether the effective viewer started it: in another tab, or before this page was loaded. */
  startedByViewer: boolean;
  /** When that start took the family (ISO). */
  startedAt: string;
}

/** Body of the 409 a second start gets: who holds the family and since when. It proves nothing was sent to the exporter. */
export interface MktgFamilyExportActiveConflict extends MktgFamilyExportRunning {
  code: typeof MKTG_FAMILY_EXPORT_ACTIVE;
}

/**
 * BFF-only in-flight marker, one per family, written only with conditional writes (create-if-absent, then
 * replace-this-version). It is never sent to a browser: `creatorSubject` is the opaque effective subject, resolved
 * to a display name only in a response.
 */
export interface MktgFamilyExportMarker {
  schema: typeof MKTG_FAMILY_EXPORT_MARKER_SCHEMA;
  project: string;
  familyId: string;
  /** Random per start: names the holder before its Guild session exists, so only that start can release it. */
  claim: string;
  creatorSubject: string;
  startedAt: string;
  /** Epoch ms after which the marker holds nothing, never later than `startedAt` plus the TTL; 0 once released. */
  expiresAt: number;
  /** The Guild session once it exists: a result poll on any replica releases the marker of the session it reads. */
  sessionId: string | null;
}

/** What a caller proves it holds when it releases the marker: the start's claim, the session's id, or both. */
export interface MktgFamilyExportHold {
  claim?: string;
  sessionId?: string;
}

/** A card's own bookkeeping while it follows an export it did not start: which one, what the last export was then, and when it stops polling. */
export interface MktgFamilyExportFollowState {
  startedAt: string;
  /** `mktgFamilyExportIdentity` of the last export when following began. */
  baseline: string;
  /** Browser clock (epoch ms) after which the card stops polling on its own. */
  until: number;
}

export interface MktgFamilyExportLastResponse {
  last: MktgFamilyExportRecord | null;
  currentMembers: MktgFamilyExportMember[];
  skippedMembers: MktgFamilyExportAgentKey[];
  stale: boolean;
  /** The export in flight for this family, whoever started it; null when none is. */
  running: MktgFamilyExportRunning | null;
}

/** Browser stream: starts immediately, then reports selected members and the final result. */
export interface MktgFamilyExportRunUpdate {
  mode: MktgSlidesExportMode;
  skippedMembers: MktgFamilyExportAgentKey[];
  logoNote: MktgSlidesExportLogoNote | null;
  result: MktgFamilyExportResultResponse | null;
}

/** Existing print renderings, composed without inventing new asset layouts. */
export interface MktgFamilyPrintView {
  framework: FoundationMessagePrintView | null;
  kit: BrandKitBookView | null;
  /** The kit revision's recorded approval, as the standalone kit print receives it (its Sources page's acceptance card and the usage page's report year); null when the family has no kit or the store records none. */
  kitApproval: MktgRevisionApproval | null;
  boilerplates: BoilerplatesPrintView | null;
  faq: FaqPrintView | null;
  brand: MktgPrintBrand;
  projectName: string;
  printedAt: string;
  /** When the newest of the printed member revisions was stored (ISO), for the PDF's name; null when none carries a date. */
  newestRevisionAt: string | null;
  fontFamily: string | null;
  weights: readonly number[];
  /** The printed members as the book's chapters name them, in exporter order (the family's cover cards, openers, contents and Sources page). */
  documents: MktgFamilyPrintDocument[];
  /** The framework's tagline for the cover's eyebrow and the back cover, '' when the family has no framework or it has none. */
  tagline: string;
  /** The project's site as the kit read it (`aaif.io`), '' when the family has no kit or it names none. */
  websiteLabel: string;
  /** The sources the boilerplates run read, [] when the revision carries no report: the Built from block is omitted then. */
  boilerplatesSources: string[];
  /**
   * Where the documents disagree: the framework's key numbers read against the FAQ's and the boilerplates' own text
   * (mktgFamilyPrintNumberConflicts), then what the store names (mktgFamilyPrintConflicts); [] omits the block.
   */
  conflicts: MktgFamilyPrintConflict[];
}

/** Validated exporter output, shared by document and family polling. */
export type MktgSlidesExportPollOutcome =
  | Exclude<MktgSlidesExportResultResponse, { status: 'ready' }>
  | { status: 'ready'; envelope: MktgSlidesExportEnvelope };

/** Server-only approved bytes beside the member identity, never accepted from a browser. */
export interface MktgFamilyExportSelection {
  type: MktgDocumentType;
  member: MktgFamilyExportMember;
  revision: MktgStoredRevision;
}
