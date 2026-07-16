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
