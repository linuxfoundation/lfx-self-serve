// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { LinkedinFormRenderVersion } from '../interfaces/linkedin-post.interface';

/** Provenance belongs to the pushed edit history entry, not the previous route. */
export const LINKEDIN_PROFILE_EDIT_PUSHED_STATE_KEY = 'mktgEditPushed';

/** Verbatim Step 1/2 copy and defaults from the live agent src/profile.ts. */
export const LINKEDIN_ABOUT_FIELDS = [
  { key: 'name', label: 'Name', ask: 'Their name' },
  { key: 'role', label: 'Role', ask: 'Their role (for personalization)' },
  { key: 'focus_areas', label: 'Focus areas', ask: 'Their primary focus areas' },
  {
    key: 'associated_projects',
    label: 'Associated projects',
    ask: 'Any projects they are closely associated with',
  },
  {
    key: 'primary_audience',
    label: 'Primary LinkedIn audience',
    ask: 'Their primary LinkedIn audience',
  },
] as const;

/**
 * The original Step 2 ("Voice and tone") fields, in their order, each with
 * the offered default for a skipped answer. `step2` is the question label;
 * `label` is the profile-file label (different only for the admired style).
 */
export const LINKEDIN_VOICE_FIELDS = [
  {
    key: 'tone',
    label: 'Tone',
    step2: 'Tone',
    default: 'conversational / authoritative / educational / enthusiastic',
  },
  {
    key: 'tendency',
    label: 'Tendency',
    step2: 'Tendency',
    default: 'direct and data-driven, with occasional humor',
  },
  {
    key: 'admired_style',
    label: 'Admired style',
    step2: 'Admired posts sound like',
    default: 'natural language, written as a conversation from person to person',
  },
  {
    key: 'avoid',
    label: 'Avoid',
    step2: 'Avoid',
    default: 'corporate jargon, buzzwords like "synergy", excessive self-promotion',
  },
] as const;

export const LINKEDIN_AGENT_KEY = 'linkedin-post';
export const LINKEDIN_CONTRACT_ID = 'linkedin-post-output/v1';
export const LINKEDIN_API = '/api/mktg-agents/linkedin-post';
export const LINKEDIN_SHARE_LINK_ANSWER_KEY = 'share_link';
export const LINKEDIN_SHARE_LINK_MAX_CHARS = 2048;
export const LINKEDIN_LINK_PLACEHOLDER = '[LINK]';
export const LINKEDIN_SHARE_LINK_HINT = 'Optional. Fills [LINK] in every option and in Copy post. Prefilled when you draft from a link; you can change it.';
export const LINKEDIN_MISSING_LINK_COPY_NOTICE = 'Copied. This post still contains [LINK] — replace it before posting.';
export const LINKEDIN_SOURCE_MAX_BYTES = 1024 * 1024;
/** A byte-bounded text can contain at most this many one-byte, space-separated words. */
export const LINKEDIN_SOURCE_MAX_WORDS = Math.ceil(LINKEDIN_SOURCE_MAX_BYTES / 2);
/** Durable at-most-once automatic profile initialization, independent of current.json deletion. */
export const LINKEDIN_PROFILE_INITIALIZATIONS = 'initializations/';
export const LINKEDIN_PROFILE_MAX_FIELD_CHARS = 4000;
export const LINKEDIN_DOCUMENT_TITLE = '# LinkedIn post options';
/** Mutable LFX presentation state, outside immutable revision records. */
export const LINKEDIN_PRESENTATION_KEY = 'presentation.json';
export const LINKEDIN_PAGE_LABEL = 'LinkedIn';
/** Default 2 since agent 2.0.0 deployed 20 Oct; renderer 1 remains available. */
export const LINKEDIN_FORM_RENDER_VERSION: LinkedinFormRenderVersion = 2;
export const LINKEDIN_SOURCE_LINK_HINT = 'Paste the public link; the agent reads the page.';
export const LINKEDIN_FINALIZE_TOOL = 'finalize_linkedin_post';
/** Seven eligible gap IDs share one interview round of at most six questions. */
export const LINKEDIN_MAX_QUESTIONS = 6;
export const LINKEDIN_QUESTIONS_CONTRACT = 'linkedin-post-questions/v1';
export const LINKEDIN_QUESTIONS_HEADER = `LINKEDIN POST — QUESTIONS (${LINKEDIN_QUESTIONS_CONTRACT})`;
export const LINKEDIN_ANSWERS_HEADER = 'LINKEDIN POST — ANSWERS (linkedin-post-answers/v1)';
export const LINKEDIN_PROFILE_GAP_LABELS: Record<string, string> = {
  role: 'Role',
  'focus-areas': 'Focus areas',
  'primary-audience': 'Audience',
  tone: 'Tone',
  tendency: 'Tendency',
  'admired-style': 'Admired style',
  avoid: 'Avoid',
};
export const LINKEDIN_SOURCE_TIMEOUT_MS = 10000;
export const LINKEDIN_LINK_CONTENT_TYPES = ['text/html', 'text/plain', 'text/markdown', 'application/xhtml+xml'] as const;
export const LINKEDIN_FILE_EXTENSIONS = ['txt', 'md', 'csv', 'html'] as const;
export const LINKEDIN_FILE_ACCEPT = LINKEDIN_FILE_EXTENSIONS.map((extension) => `.${extension}`).join(',');
export const LINKEDIN_FILE_TYPES_LABEL = LINKEDIN_FILE_EXTENSIONS.map((extension) => `.${extension}`).join(', ');
export const LINKEDIN_CONTENT_SOURCES = [
  { value: 'text', label: 'Paste text' },
  { value: 'url', label: 'Link' },
  { value: 'file', label: 'Upload a file' },
] as const;
