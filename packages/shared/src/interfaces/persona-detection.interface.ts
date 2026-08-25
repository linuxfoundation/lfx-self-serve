// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Account } from './account.interface';
import type { PersonaType } from './persona.interface';

export interface PersonaDetectionRequest {
  username: string;
  email: string;
}

export interface PersonaDetectionResponse {
  projects: PersonaDetectionProject[];
  error: PersonaDetectionError | null;
}

export interface PersonaDetectionProject {
  project_uid: string;
  project_slug: string;
  detections: PersonaDetection[];
}

export interface PersonaDetection {
  source: string;
  extra?: Record<string, unknown>;
}

export interface PersonaDetectionError {
  code: string;
  message: string;
}

export interface EnrichedPersonaProject {
  projectUid: string;
  projectSlug: string;
  projectName: string | null;
  parentProjectUid: string | null;
  isFoundation: boolean;
  logoUrl: string | null;
  description: string | null;
  detections: PersonaDetection[];
  personas: PersonaType[];
}

export interface PersonaProject {
  projectUid: string;
  projectSlug: string;
  projectName: string | null;
}

export interface PersonaDetections {
  personaProjects: Partial<Record<PersonaType, PersonaProject[]>>;
  personas: PersonaType[];
  projects: EnrichedPersonaProject[];
  organizations: Account[];
  error: string | null;
}

export interface PersonaApiResponse extends PersonaDetections {
  /** Writer on the tenant root project — bypasses nav persona filtering. Request-scoped, not cached. */
  isRootWriter: boolean;
  /** Member of the lf-staff team — unlocks executive-tier dashboards without granting the ED persona. Request-scoped, not cached. */
  isLFStaff: boolean;
  /**
   * Root- or project-scoped `marketing_auditor` FGA grant (project scope applies when the request
   * carries `?project=`) (LFXV2-2235/LFXV2-2236). Only ever computed while
   * `ServerFeatureFlag.MarketingOpsFga` is on — always `false` while the flag is off. Request-scoped,
   * not cached.
   */
  isMarketingAuditor: boolean;
  /** Root- or project-scoped `campaign_manager` FGA grant. Same flag/caching caveats as {@link isMarketingAuditor}. */
  isCampaignManager: boolean;
}

export interface SsrPersonaResult {
  persona: PersonaType;
  personas: PersonaType[];
  organizations?: Account[];
  projects?: EnrichedPersonaProject[];
  personaProjects?: Partial<Record<PersonaType, PersonaProject[]>>;
}

/** Stores in-flight promise to collapse concurrent lookups. */
export interface AffiliatedProjectUidsCacheEntry {
  promise: Promise<string[]>;
  expiresAt: number;
}

/** Stores in-flight promise to collapse concurrent lookups. */
export interface PersonaApiResponseCacheEntry {
  promise: Promise<PersonaDetections>;
  expiresAt: number;
}
