// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { PersonaType } from './persona.interface';

/**
 * Request payload for the persona detection NATS RPC
 */
export interface PersonaDetectionRequest {
  username: string;
  email: string;
}

/**
 * Raw response from the persona detection service via NATS
 */
export interface PersonaDetectionResponse {
  projects: PersonaDetectionProject[];
  error: PersonaDetectionError | null;
}

/**
 * A project with its detection results from the persona service
 */
export interface PersonaDetectionProject {
  project_uid: string;
  project_slug: string;
  detections: PersonaDetection[];
}

/**
 * A single detection result identifying how a user is associated with a project
 */
export interface PersonaDetection {
  source: string;
  extra?: Record<string, unknown>;
}

/**
 * Error response from the persona detection service
 */
export interface PersonaDetectionError {
  code: string;
  message: string;
}

/**
 * A project enriched with name and derived personas for UI consumption
 */
export interface EnrichedPersonaProject {
  projectUid: string;
  projectSlug: string;
  projectName: string | null;
  /** Parent project UID (null if this is a top-level foundation) */
  parentProjectUid: string | null;
  /** Whether this project is a foundation (top-level) */
  isFoundation: boolean;
  /** Project logo URL (null if unavailable) */
  logoUrl: string | null;
  /** Project description text (null if unavailable) */
  description: string | null;
  detections: PersonaDetection[];
  personas: PersonaType[];
}

/**
 * Minimal project reference used in persona-to-project mapping
 */
export interface PersonaProject {
  projectUid: string;
  projectSlug: string;
  projectName: string | null;
}

/**
 * Full persona API response returned by GET /api/user/personas
 */
export interface PersonaApiResponse {
  /** Persona-centric view: for each persona, which projects it applies to */
  personaProjects: Partial<Record<PersonaType, PersonaProject[]>>;
  /** All unique personas the user has, sorted by priority (highest first) */
  personas: PersonaType[];
  /** Project-centric view with full detection details */
  projects: EnrichedPersonaProject[];
  /** Whether the user has access to multiple distinct projects */
  multiProject: boolean;
  /** Whether the user has access to projects under multiple foundations */
  multiFoundation: boolean;
  /** Error message if the persona detection failed */
  error: string | null;
}

/**
 * Result of SSR persona resolution (hybrid cookie/NATS strategy)
 */
export interface SsrPersonaResult {
  persona: PersonaType;
  personas: PersonaType[];
}
