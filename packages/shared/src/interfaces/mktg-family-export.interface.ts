// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MKTG_FAMILY_EXPORT_KINDS } from '../constants/mktg-family-export.constants';
import type { MktgDocumentType, MktgStoredRevision } from './mktg-document-store.interface';
import type { BrandKitBookView } from './brand-kit.interface';
import type { FoundationMessagePrintView } from './mktg-print.interface';
import type {
  MktgSlidesExportDeckRecord,
  MktgSlidesExportEnvelope,
  MktgSlidesExportLogoNote,
  MktgSlidesExportMode,
  MktgSlidesExportPollResponse,
  MktgSlidesExportResultResponse,
} from './mktg-slides-export.interface';

export type MktgFamilyExportAgentKey = keyof typeof MKTG_FAMILY_EXPORT_KINDS;

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

export interface MktgFamilyExportLastResponse {
  last: MktgFamilyExportRecord | null;
  currentMembers: MktgFamilyExportMember[];
  skippedMembers: MktgFamilyExportAgentKey[];
  stale: boolean;
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
  fontFamily: string | null;
  weights: readonly number[];
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
