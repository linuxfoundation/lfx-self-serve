// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MKTG_ARTIFACT_MAX_DOCUMENT_BYTES } from './mktg-artifact.constants';

/** Verbatim category labels and order from the live agent's rubric. */
export const AEO_GEO_CATEGORIES = [
  { key: 'ai_crawler_access', label: 'AI crawler access' },
  { key: 'llms_txt', label: 'llms.txt' },
  { key: 'content_answerability', label: 'Content answerability' },
  { key: 'technical_metadata', label: 'Technical metadata' },
  { key: 'external_authority', label: 'External authority (GEO)' },
  { key: 'content_depth_freshness', label: 'Content depth & freshness' },
] as const;

/** Five independent URL controls; three shown initially, with add-row up to five. */
export const AEO_GEO_KEY_PAGE_FIELDS = Array.from({ length: 5 }, (_, index) => ({ key: `page_${index + 1}`, number: index + 1 }));
export const AEO_GEO_RECENT_RUNS_LIMIT = 5;
export const AEO_GEO_REFUSAL_MAX_CHARS = 2000;
export const AEO_GEO_TIMEOUT_MESSAGE = 'The audit is taking longer than expected.';

export const AEO_GEO_CONTRACT_ID = 'aeo-geo-output/v1';
export const AEO_GEO_QUESTIONS_CONTRACT = 'aeo-geo-questions/v1';
export const AEO_GEO_QUESTIONS_HEADER = `AEO/GEO — QUESTIONS (${AEO_GEO_QUESTIONS_CONTRACT})`;
export const AEO_GEO_ANSWERS_HEADER = 'AEO/GEO — ANSWERS (aeo-geo-answers/v1)';
export const AEO_GEO_FINALIZE_TOOL = 'finalize_aeo_geo_report';
export const AEO_GEO_QUESTION_KEY_PREFIX = 'aeo-';
export const AEO_GEO_QUESTION_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const AEO_GEO_ANSWER_ORIGINS = ['requester', 'accepted', 'edited'] as const;
export const AEO_GEO_DOMAIN_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/;
export const AEO_GEO_HTTP_URL_PATTERN = /^https?:\/\/\S+$/;
export const AEO_GEO_SECTIONS = ['## Scorecard', "## What's working", '## Recommendations (priority order)', '## Caveats & unverified items', '## Sources'];
export const AEO_GEO_MAX_DOCUMENT_BYTES = MKTG_ARTIFACT_MAX_DOCUMENT_BYTES;
export const AEO_GEO_INTAKE_ERRORS = {
  domain: 'Enter a valid domain or website URL, e.g. project.example or https://project.example/. Public website names only.',
  key_pages: 'Leave blank to let the agent choose, or enter two to five different absolute http(s) URLs, one per line. Public website names only.',
} as const;
