// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { AEO_GEO_CATEGORIES } from '../constants/aeo-geo.constants';

export type AeoGeoCategoryKey = (typeof AEO_GEO_CATEGORIES)[number]['key'];
export type AeoGeoScores = Record<AeoGeoCategoryKey, number>;

/** Mirrors marketing-os-agents agents/aeo-geo/src/envelope.ts, aeo-geo-output/v1. */
export interface AeoGeoEnvelope {
  contract: 'aeo-geo-output/v1';
  kind: 'aeo-geo-report';
  domain: string;
  report_filename: string;
  version: number;
  document_markdown: string;
  content_sha256: string;
  overall_score: number;
  verdict: string;
  scores: AeoGeoScores;
  /** 2.0 structured presentation; absent on legacy Markdown-only reports. */
  report?: AeoGeoReport;
  inputs: { key_pages_provided: boolean; key_pages_count?: number; pages_audited: string[] };
  capabilities: { web_fetch: boolean; web_search: boolean };
  intake: { completed_at: string; mode: 'form' };
  generated_at: string;
  agent: { identifier?: string; agent_version: string; prompt_manifest_sha256: string };
}

/** Validated report presentation read from a stored revision's sidecar. */
export interface AeoGeoReportSummary extends Pick<AeoGeoEnvelope, 'domain' | 'report_filename' | 'overall_score' | 'verdict' | 'scores' | 'report'> {
  /**
   * CamelCase BFF projection from the stored sidecar's `inputs`, not a field
   * of the agent's `aeo-geo-output/v1` envelope. Optional for older response
   * shapes; the current BFF derives it from schema-validated stored inputs.
   */
  auditCounts?: { keyPagesNamed: number; pagesAudited: number };
}

export interface AeoGeoFormPayload {
  type: 'aeo_geo_intake_form';
  domain: string;
  key_pages?: string[];
  /** Optional LFX context, rendered as the 2.0 agent's LFX SCOPE line. */
  project_name?: string;
  project_uid?: string;
}

export interface AeoGeoValidationResult {
  valid: boolean;
  errors: string[];
}

export interface AeoGeoQuestionsTurn {
  contract: 'aeo-geo-questions/v1';
  project: string;
  questions: { id: string; question: string; why: string; suggested_answer: string; basis: string }[];
}

export interface AeoGeoAnswer {
  id: string;
  text: string;
  origin: 'requester' | 'accepted' | 'edited';
}

export interface AeoGeoAnswersBody {
  project: string;
  sessionId: string;
  ownerToken: string;
  documentId: string;
  answers: AeoGeoAnswer[];
}

export interface AeoGeoReport {
  headline: string;
  scorecard: { key: AeoGeoCategoryKey; label: string; score: number; summary: string }[];
  overall_score: number;
  verdict: string;
  findings: { title: string; detail: string; category: AeoGeoCategoryKey | null; evidence: string[] }[];
  recommendations: { priority: number; title: string; detail: string; category: AeoGeoCategoryKey | null }[];
  caveats: string[];
  sources: { url: string; role: 'audited' | 'external' | 'search' }[];
}
