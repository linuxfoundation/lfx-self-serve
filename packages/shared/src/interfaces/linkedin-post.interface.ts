// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { MktgPendingDocumentRun, MktgRunResultResponse, MktgRunSessionResponse } from './mktg-run.interface';

/** Per-user posting identity, in the live linkedin-post-output/v1 contract. */
export interface LinkedinProfile {
  about: { name: string; role: string; focus_areas: string; associated_projects: string; primary_audience: string };
  voice: { tone: string; tendency: string; admired_style: string; avoid: string };
}
export type LinkedinSetup = Partial<LinkedinProfile['voice']> & Omit<LinkedinProfile['about'], 'associated_projects'> & { associated_projects?: string };
export type LinkedinProfileInput = { setup: LinkedinSetup; profile?: never } | { profile: LinkedinProfile; setup?: never };
export interface LinkedinStoredProfile {
  profile: LinkedinProfile;
  profile_markdown: string;
}
export interface LinkedinOption {
  number: number;
  label: string;
  text: string;
  word_count: number;
  hashtags: string[];
  tagging_suggestions: string[];
}
export type LinkedinContentSource = 'text' | 'url' | 'file';
/** Normative output shape; validated before use, including SHA-256 on the BFF. */
export interface LinkedinEnvelope extends LinkedinStoredProfile {
  contract: 'linkedin-post-output/v1';
  kind: 'linkedin-post';
  version: number;
  options: LinkedinOption[];
  document_markdown: string;
  content_sha256: string;
  profile_source: 'first_run_setup' | 'saved_profile';
  profile_update_note?: string;
  notes?: string[];
  /** Known render fields stay validated; research/additive input provenance is opaque. */
  inputs: { content_source: LinkedinContentSource; content_url?: string; content_file_name?: string; feedback_provided: boolean; [key: string]: unknown };
  generated_at: string;
  agent: { identifier: 'linux-foundation~linkedin-post'; agent_version: string; prompt_manifest_sha256: string };
}
export type LinkedinFormRenderVersion = 1 | 2;

/** Server-composed form; no feedback path in this WorkItem. */
export interface LinkedinForm {
  project_name?: string;
  project_uid?: string;
  today: string;
  saved_profile?: LinkedinProfile;
  setup?: LinkedinSetup;
  content_source: LinkedinContentSource;
  content_text: string;
  content_url?: string;
  content_file_name?: string;
}
export interface LinkedinGeneration extends MktgRunSessionResponse {
  /** Last answered gap round, retained with a pending capability to avoid asking twice after reload. */
  answeredQuestionsId?: string;
  documentId: string;
  /** LFX-only run answers, never sent to the agent. */
  answers?: Record<string, string>;
  source: { label: string; words: number; fetched: boolean };
}
export interface LinkedinPendingRun extends MktgPendingDocumentRun {
  answeredQuestionsId?: string;
  source: LinkedinGeneration['source'];
}
export interface LinkedinResult extends MktgRunResultResponse {
  questionsProject?: string;
  envelope?: LinkedinEnvelope;
  profileSaved?: boolean;
  /** LFX-only link metadata persisted alongside the options. */
  answers?: Record<string, string>;
}

export interface LinkedinQuestionItem {
  id: string;
  question: string;
  why: string;
  suggested_answer: string;
  basis: string;
}
export interface LinkedinQuestionsTurn {
  contract: 'linkedin-post-questions/v1';
  project: string;
  questions: LinkedinQuestionItem[];
}

export interface LinkedinPostTextPart {
  text: string;
  needsLink: boolean;
  href?: string;
}
export interface LinkedinOptionPresentation extends LinkedinOption {
  parts: LinkedinPostTextPart[];
  copyText: string;
  missingLink: boolean;
}
/** Resolved at read time; no directory identity is exposed to the browser. */
export interface LinkedinDocumentAuthor {
  name: string | null;
}
export interface LinkedinShareLinkResponse {
  share_link: string;
}
export interface LinkedinDocumentContent {
  author?: LinkedinDocumentAuthor;
  isAuthor?: boolean;
  source?: LinkedinGeneration['source'];
  options: LinkedinOption[];
  notes: string[];
  answers: Record<string, string>;
}
