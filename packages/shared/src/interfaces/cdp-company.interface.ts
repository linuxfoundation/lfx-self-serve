// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Company Lens — CDP companies (lfx-self-serve#2092, spec 062): the wire shapes of `/api/companies/*`
// (contracts/bff-cdp-companies.md, contracts/bff-cdp-search.md). Counts and labels only: no person-level field (FR-018).

import { CDP_COMPANY_ERROR_CODES, CDP_COMPANY_SECTION_KEYS } from '../constants/cdp-company.constants';

/** A CDP company page section (FR-025). */
export type CdpSectionKey = (typeof CDP_COMPANY_SECTION_KEYS)[number];

/** Whether the server serves a section for this company (FR-026). */
export type CdpSectionState = 'on' | 'off-by-design';

/** `ok`: a searchable company with counts; the other two: addressable but below the search rule, shown with no counts (FR-017, FR-034). */
export type CdpCompanyPageState = 'ok' | 'no-activity' | 'not-enough-activity';

/** A refusal code of the CDP company BFF. */
export type CdpCompanyErrorCode = (typeof CDP_COMPANY_ERROR_CODES)[keyof typeof CDP_COMPANY_ERROR_CODES];

/** `GET /api/companies/availability`: the browser's only CDP audience signal (FR-014). */
export interface CdpCompanyAvailability {
  available: boolean;
}

/** The browser's reading of `/availability`: `unverifiable` when the server could not decide (503), so pages show "could not verify" (FR-013). */
export type CdpCompanyAudienceSignal = 'available' | 'unavailable' | 'unverifiable';

/** One CDP row of the org selector: name and logo only, never a top project, domain or count (FR-022). */
export interface CdpCompanyItem {
  cdpId: string;
  name: string;
  logoUrl?: string;
}

/** `GET /api/companies/search?name=` (contracts/bff-cdp-search.md). */
export interface CdpCompanySearchResponse {
  /** At most `CDP_COMPANY_SEARCH_MAX_ROWS`. */
  items: CdpCompanyItem[];
  /** True when the read missed its deadline, failed, or the list was built more than 48 hours ago (FR-023). */
  unavailable?: boolean;
}

/** Company-level facts of a CDP page; the top project only behind the caller's `project#viewer` (FR-020). */
export interface CdpCompanySummary {
  cdpId: string;
  name: string;
  logoUrl?: string;
  topProjectName?: string;
  /** `YYYY-MM` of the latest counted activity; null when none is on record. */
  lastActiveMonth: string | null;
}

export interface CdpCompanySection {
  key: CdpSectionKey;
  state: CdpSectionState;
}

/** `GET /api/companies/:cdpId` for an addressable company. Non-`ok` states carry no counts and no sections are served for them. */
export interface CdpCompanyPage {
  state: CdpCompanyPageState;
  company: CdpCompanySummary;
  sections: CdpCompanySection[];
}

/** Where an old or B2B-linked CDP id now lives (FR-033): another CDP id, or a company's Company Lens segment. */
export interface CdpCompanyRedirectTarget {
  kind: 'cdp' | 'b2b';
  /** `cdp`: a CDP id. `b2b`: the company's Company Lens address segment (slug, or SFID when it has none). */
  target: string;
}

/** `GET /api/companies/:cdpId` for a merged or B2B-linked id whose target the caller can read. */
export interface CdpCompanyRedirect {
  redirect: CdpCompanyRedirectTarget;
}

export type CdpCompanyResponse = CdpCompanyPage | CdpCompanyRedirect;

/** Every refusal body of `/api/companies/*` (contracts/bff-cdp-companies.md). Never echoes the id (FR-035). */
export interface CdpCompanyErrorBody {
  code: CdpCompanyErrorCode;
}

/** Dashboard section: totals over every project Insights shows, LF and non-LF (FR-019, DR-029). */
export interface CdpCompanyDashboard {
  contributors730d: number;
  activities730d: number;
  lastActiveMonth: string | null;
  topProjectName?: string;
}

export interface CdpCompanyProjectRow {
  projectName: string;
  contributors: number;
  activities: number;
}

/** Projects section: LF projects the caller passes `project#viewer` on (FR-020). */
export interface CdpCompanyProjects {
  rows: CdpCompanyProjectRow[];
}

export interface CdpCompanyProfile {
  name: string;
  logoUrl?: string;
  topProjectName?: string;
  lastActiveMonth: string | null;
}

export interface CdpCompanyEventRow {
  eventName: string;
  /** `YYYY-MM-DD`; null when the warehouse has no date. */
  eventDate: string | null;
  attendees: number;
}

/** Events section: people who attended, per event, at least 5 per row (FR-028, FR-030). */
export interface CdpCompanyEvents {
  rows: CdpCompanyEventRow[];
}

/** Training & Certification section: each total absent under 5 people (FR-029, FR-030). */
export interface CdpCompanyTraining {
  enrollments?: number;
  certifications?: number;
}

export interface CdpCompanyMeetingRow {
  projectName: string;
  meetingType: string;
  attendance: number;
}

/** Meetings section (LF staff only, behind its flag): attendance per project and meeting type (FR-031). */
export interface CdpCompanyMeetings {
  rows: CdpCompanyMeetingRow[];
}

export interface CdpCompanyGroupRow {
  committeeName: string;
  projectName: string;
  activeSeats: number;
}

/** Groups section (LF staff only, behind its flag): active seats per committee or board (FR-032). */
export interface CdpCompanyGroups {
  rows: CdpCompanyGroupRow[];
}

/** `GET /api/companies/:cdpId/sections/:section` payload per section. */
export interface CdpCompanySectionPayloads {
  dashboard: CdpCompanyDashboard;
  projects: CdpCompanyProjects;
  profile: CdpCompanyProfile;
  events: CdpCompanyEvents;
  training: CdpCompanyTraining;
  meetings: CdpCompanyMeetings;
  groups: CdpCompanyGroups;
}

/** Any one section payload. */
export type CdpCompanySectionPayload = CdpCompanySectionPayloads[CdpSectionKey];
