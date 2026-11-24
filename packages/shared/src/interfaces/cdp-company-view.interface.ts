// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Company Lens — CDP companies (lfx-self-serve#2092, spec 062): what the browser renders for a CDP company page.

import type { CdpCompanyPage, CdpCompanySectionPayloads, CdpSectionKey } from './cdp-company.interface';

/**
 * What the company shell renders for `/company/{CDP id}`.
 *
 * `no-company` covers an outsider, an unknown id and a malformed id alike, so the three read the same (FR-012, FR-035);
 * `could-not-verify` is a failed audience check (FR-013); `could-not-load` any other failed page read; the
 * `low-activity-*` states carry no counts (FR-017, FR-034).
 */
export type CdpCompanyShellState = 'loading' | 'no-company' | 'could-not-verify' | 'could-not-load' | 'low-activity-none' | 'low-activity-not-enough' | 'ok';

/** The shell's reading of one CDP address: the page only for `ok` and the `low-activity-*` states. */
export interface CdpCompanyShellView {
  state: CdpCompanyShellState;
  page: CdpCompanyPage | null;
}

/** What one CDP section page renders (FR-025, FR-026, FR-031, FR-032). */
export type CdpCompanySectionViewState = 'loading' | 'ready' | 'empty' | 'off-by-design' | 'no-access' | 'could-not-verify' | 'could-not-load';

/** One CDP section read as a page renders it: the payload only when `ready` or `empty`. */
export interface CdpCompanySectionResult<K extends CdpSectionKey> {
  state: CdpCompanySectionViewState;
  data: CdpCompanySectionPayloads[K] | null;
}

/** The CDP company on screen, shared with the Company Lens navigation. Never written to cookies or the role-grants cache. */
export interface CdpCompanyNavContext {
  cdpId: string;
  /** The page the server answered; null while loading and when the address opens no page. */
  page: CdpCompanyPage | null;
  /** False until the shell has an answer for this id. */
  settled: boolean;
}

/** Label, icon and header copy of one CDP section (no company name: the page header adds it). */
export interface CdpCompanySectionMeta {
  key: CdpSectionKey;
  label: string;
  icon: string;
  description: string;
}

/** A Company Lens section a CDP company never offers, greyed in its navigation (FR-025). */
export interface CdpCompanyOffNavItem {
  key: string;
  label: string;
  icon: string;
}
