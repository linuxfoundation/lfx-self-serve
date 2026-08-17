// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// UI-facing shapes for the read-only "My CLAs" view (Me lens → Profile tab).
// Normalized by the LFX One server from upstream EasyCLA signature records.
// See specs/001-easycla-ss-integration-fable/m1-my-cla/data-model.md.

export type ClaKind = 'ICLA' | 'ECLA';

/**
 * Agreement status shown in the UI:
 * - `valid`           — currently valid per EasyCLA's computed `valid` flag.
 * - `needs_attention` — approved, but no longer covered (ECLA only; ICLA never produces this).
 * - `invalidated`     — the stored signature-approval flag is false or absent.
 * - `unknown`         — coverage could not be evaluated (ECLA only; ICLA never produces this).
 *                       Rendered as plain-text "—", not a fourth named pill.
 * - `superseded`      — reserved: an older document version than the CLA group's current.
 *                       Not produced today (the my-clas endpoint does not expose the
 *                       current version); kept for forward compatibility. Do not render it.
 */
export type ClaStatus = 'valid' | 'needs_attention' | 'invalidated' | 'unknown' | 'superseded';

export type ClaStatusReason = 'not_on_approval_list' | 'unknown';

/** A single signed CLA shown in the My CLAs list. */
export interface MyClaAgreement {
  /** EasyCLA signatureID — also the key for the PDF-URL endpoint. */
  id: string;
  kind: ClaKind;
  /**
   * CLA group name the agreement was signed against (the endpoint's `claGroupName`,
   * falling back to the CLA group UUID). This is NOT the Salesforce project name —
   * see `projectName`. Rendered as the subtext of the Project cell when a
   * `projectName` is present, and as the primary line when it is not.
   */
  claGroupName: string;
  /**
   * Salesforce project display name the CLA Group belongs to (a foundation-level CLA
   * Group resolves to its foundation). Undefined when upstream could not resolve it —
   * the Project cell then falls back to `claGroupName`. Rendered as the bold primary line.
   */
  projectName?: string;
  /** Project (or foundation) logo URL, when upstream resolved one. Undefined ⇒ show the fallback icon. */
  projectLogo?: string;
  /** Employer company name — present for ECLA only. */
  companyName?: string;
  /** ISO date the agreement was signed. */
  signedOn: string;
  status: ClaStatus;
  statusReason?: ClaStatusReason;
  /** Signed document version, when exposed upstream (display only). */
  documentVersion?: string;
  /** True only for ICLA — ECLAs have no signed PDF and never offer download. */
  pdfAvailable: boolean;
}

/** Identity-resolution summary — counts and flags only, never raw EasyCLA IDs. */
export interface MyClasIdentitySummary {
  /** Number of EasyCLA user records matched to the session identity. */
  matchedUserIds: number;
  /** True when resolution found no records ⇒ show "history may be incomplete" hint. */
  unmatched: boolean;
  /** False ⇒ show "Don't see your CLAs? Link your GitHub account" CTA. */
  githubLinked: boolean;
}

/** Response for `GET /api/me/clas`. */
export interface MyClasResponse {
  /** Agreements sorted by `signedOn` descending. */
  agreements: MyClaAgreement[];
  identity: MyClasIdentitySummary;
}

/** View state for the My CLAs tab: the last response (or null), plus load/error flags. */
export interface MyClasState {
  data: MyClasResponse | null;
  error: boolean;
  loaded: boolean;
}

/** Response for `GET /api/me/clas/:signatureId/pdf-url`. */
export interface PdfUrlResponse {
  /** Short-lived presigned S3 URL (~15 min TTL). */
  url: string;
  expiresInSeconds: number;
}

/**
 * A CLA Group the contributor can choose to sign against (Sign CLA hand-off, #1251).
 *
 * Deliberately minimal: the hand-off needs `claGroupId` and the contributor needs a name
 * to pick by. The real four-source search (#1250) may return more (logo, foundation, match
 * provenance) — consumers MUST ignore unknown fields rather than validate exhaustively, so
 * that search can enrich this without touching the hand-off.
 */
export interface ClaGroupOption {
  /** Must be a real CLA Group UUID: the Contributor Console fetches the project by it. */
  claGroupId: string;
  /** Primary line in the picker. */
  projectName: string;
  /** Secondary line — the CLA group within the project, when it differs from the project name. */
  claGroupName?: string;
}

/**
 * Response for `GET /api/me/clas/sign-handoff` — the two halves of the Console URL that only
 * the server can produce. The client supplies the rest (Console base + CLA group) and composes
 * the final URL via `buildConsoleHandoffUrl`.
 */
export interface ClaSignHandoff {
  /** EasyCLA user record UUID, resolved from the session token — never from client input. */
  claUserId: string;
  /** Absolute URL back to the CLAs view. Absolute because the last hop is a server-side redirect. */
  redirectUrl: string;
}
