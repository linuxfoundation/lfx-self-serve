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
   * `auditor` FGA grant on the tenant ROOT project — the Formations queue's (`foundation/formations`,
   * GH-1958) authorization boundary. Unlike {@link isMarketingAuditor}, `auditor` has no
   * project-scoped variant to race, so this is always computed (not flag-gated) and carries no
   * "root grant" distinction field. Request-scoped, not cached.
   */
  isAuditor: boolean;
  /**
   * Root- or project-scoped `marketing_auditor` FGA grant (project scope applies when the request
   * carries `?project=`) (LFXV2-2235/LFXV2-2236). Only ever computed while
   * `ServerFeatureFlag.MarketingOpsFga` is on — always `false` while the flag is off. Request-scoped,
   * not cached.
   */
  isMarketingAuditor: boolean;
  /** Root- or project-scoped `campaign_manager` FGA grant. Same flag/caching caveats as {@link isMarketingAuditor}. */
  isCampaignManager: boolean;
  /**
   * True when {@link isMarketingAuditor} was satisfied by the ROOT-scoped check rather than the
   * project-scoped one — lets a caller distinguish a grant that cascades to every foundation from
   * one that only answers for the requested `?project=` slug (Copilot finding, PR #1835: without
   * this, the frontend has no way to tell the two apart and mis-scopes a ROOT grant to a single
   * foundation). `false` (not `undefined`) whenever {@link isMarketingAuditor} is `false`.
   */
  isMarketingAuditorRootGrant: boolean;
  /** Same distinction as {@link isMarketingAuditorRootGrant}, for {@link isCampaignManager}. */
  isCampaignManagerRootGrant: boolean;
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
