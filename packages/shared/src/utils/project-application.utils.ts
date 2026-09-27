// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  PROJECT_APPLICATION_FIELD_LABELS,
  PROJECT_APPLICATION_SECTIONS,
  PROJECT_APPLICATION_STATE_META,
  PROJECT_APPLICATION_UNKNOWN_STATE_META,
} from '../constants/project-application.constants';
import { EMAIL_REGEX } from '../constants/regex.constants';
import type {
  ProjectApplication,
  ProjectApplicationAnswers,
  ProjectApplicationAnswerSection,
  ProjectApplicationStateMeta,
  ProjectApplicationValidationIssue,
  UpstreamProjectApplication,
  UpstreamProjectApplicationDoc,
} from '../interfaces/project-application.interface';

/** Answer keys validated as URLs; the repository also requires a hostname (formation-service rule). */
const URL_KEYS_REQUIRING_HOST = new Set(['project_repository_url']);
const URL_KEYS = new Set(['project_repository_url', 'project_website']);
const BOOLEAN_KEYS = new Set(['is_spec_project']);
const LIST_KEYS = new Set(['formation_list']);
const EMAIL_KEYS = new Set(['legal_contact_email']);

/** Normalizes a query-service `project_application` document onto the browser shape. */
export function normalizeProjectApplicationDoc(doc: UpstreamProjectApplicationDoc): ProjectApplication {
  return {
    uid: doc.object_id,
    state: doc.state,
    revision: doc.revision,
    submitter_username: doc.submitter_username,
    submitter_name: doc.submitter_name,
    submitter_email: doc.submitter_email,
    target_parent_uid: doc.target_parent_uid ?? null,
    application: doc.application ?? {},
    created_at: doc.created_at,
    updated_at: doc.updated_at,
  };
}

/** Normalizes a formation-service `ProjectApplication` result onto the browser shape. */
export function normalizeUpstreamProjectApplication(app: UpstreamProjectApplication): ProjectApplication {
  return {
    uid: app.uid,
    state: app.state,
    revision: app.revision,
    submitter_username: app.submitter_username,
    submitter_name: app.submitter_name,
    submitter_email: app.submitter_email,
    target_parent_uid: app.target_parent_uid ?? null,
    application: app.application ?? {},
    created_at: app.created_at,
    updated_at: app.updated_at,
  };
}

/** Label + tag severity for a state; unseen states render their raw value rather than breaking. */
export function getProjectApplicationStateMeta(state: string | null | undefined): ProjectApplicationStateMeta {
  if (!state) {
    return PROJECT_APPLICATION_UNKNOWN_STATE_META;
  }
  return PROJECT_APPLICATION_STATE_META[state] ?? { ...PROJECT_APPLICATION_UNKNOWN_STATE_META, label: humanizeProjectApplicationKey(state) };
}

/** Only a `submitted` application can still be revised, withdrawn, accepted or denied. */
export function isProjectApplicationOpen(application: Pick<ProjectApplication, 'state'>): boolean {
  return application.state === 'submitted';
}

/** `formation_list` → `Formation list`. */
export function humanizeProjectApplicationKey(key: string): string {
  const spaced = key.replace(/[_-]+/g, ' ').trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : key;
}

/** Label for an answer key — the configured UI label, else the humanized key. */
export function getProjectApplicationFieldLabel(key: string): string {
  return PROJECT_APPLICATION_FIELD_LABELS[key] ?? humanizeProjectApplicationKey(key);
}

/**
 * Plain-text rendering of one answer value. Booleans read Yes/No, lists join with commas, nested values are
 * JSON-encoded (never rendered as HTML). Blank values return `''` so callers can skip them.
 */
export function formatProjectApplicationAnswer(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => formatProjectApplicationAnswer(entry))
      .filter(Boolean)
      .join(', ');
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value).trim();
}

/**
 * Groups an answer map into the detail view's sections. Keys this UI doesn't configure — a newer form's
 * answers, or the staff-set parent — land in a trailing "Other answers" section so nothing is hidden.
 */
export function buildProjectApplicationAnswerSections(answers: ProjectApplicationAnswers | null | undefined): ProjectApplicationAnswerSection[] {
  const source = answers ?? {};
  const known = new Set<string>();
  const sections: ProjectApplicationAnswerSection[] = [];

  for (const section of PROJECT_APPLICATION_SECTIONS) {
    const rows = section.keys
      .map((key) => {
        known.add(key);
        return { key, label: getProjectApplicationFieldLabel(key), value: formatProjectApplicationAnswer(source[key]) };
      })
      .filter((row) => row.value !== '');
    if (rows.length > 0) {
      sections.push({ title: section.title, rows });
    }
  }

  const otherRows = Object.keys(source)
    .filter((key) => !known.has(key))
    .sort()
    .map((key) => ({ key, label: getProjectApplicationFieldLabel(key), value: formatProjectApplicationAnswer(source[key]) }))
    .filter((row) => row.value !== '');
  if (otherRows.length > 0) {
    sections.push({ title: 'Other answers', rows: otherRows });
  }

  return sections;
}

/**
 * Upserts a write result into a list the UI already holds. Query-service lags a successful write, so the UI
 * keeps the returned application rather than refetching — but never lets an older revision overwrite a newer one.
 */
export function upsertProjectApplication(list: ProjectApplication[], application: ProjectApplication): ProjectApplication[] {
  const index = list.findIndex((existing) => existing.uid === application.uid);
  if (index === -1) {
    return [application, ...list];
  }
  if (list[index].revision > application.revision) {
    return list;
  }
  const next = [...list];
  next[index] = application;
  return next;
}

/**
 * Overlays locally-known write results on a fresh query read. A document the index hasn't caught up on yet
 * (older revision, or not indexed at all) is replaced by the local copy; deleted UIDs are dropped.
 */
export function reconcileProjectApplications(
  fetched: ProjectApplication[],
  local: ProjectApplication[],
  deletedUids: ReadonlySet<string> = new Set()
): ProjectApplication[] {
  let merged = fetched.filter((application) => !deletedUids.has(application.uid));
  for (const application of local) {
    if (!deletedUids.has(application.uid)) {
      merged = upsertProjectApplication(merged, application);
    }
  }
  return merged;
}

/**
 * Validates an answer map against formation-service's canonical-field rules, so the BFF can refuse a bad
 * payload with a field-specific message before the upstream round trip. Messages never echo the value.
 */
export function validateProjectApplicationAnswers(answers: unknown): ProjectApplicationValidationIssue[] {
  if (answers === null || typeof answers !== 'object' || Array.isArray(answers)) {
    return [{ field: 'application', message: 'application must be an object' }];
  }

  const issues: ProjectApplicationValidationIssue[] = [];
  for (const [key, value] of Object.entries(answers as Record<string, unknown>)) {
    if (key.includes('\u0000')) {
      issues.push({ field: 'application', message: 'answer keys must not contain NUL characters' });
      continue;
    }
    if (value === null || value === undefined) {
      continue;
    }
    if (containsNul(value)) {
      issues.push({ field: key, message: `${key} must not contain NUL characters` });
      continue;
    }

    if (BOOLEAN_KEYS.has(key)) {
      if (typeof value !== 'boolean') {
        issues.push({ field: key, message: `${key} must be true or false` });
      }
      continue;
    }

    if (LIST_KEYS.has(key)) {
      if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || !EMAIL_REGEX.test(entry.trim().toLowerCase()))) {
        issues.push({ field: key, message: `${key} must be a list of email addresses` });
      }
      continue;
    }

    if (!isCanonicalKey(key)) {
      // Unknown keys are retained upstream as-is; only NUL is refused for them.
      continue;
    }

    if (typeof value !== 'string') {
      issues.push({ field: key, message: `${key} must be a string` });
      continue;
    }

    const trimmed = value.trim();
    if (!trimmed) {
      continue;
    }

    if (URL_KEYS.has(key) && !isHttpUrl(trimmed, URL_KEYS_REQUIRING_HOST.has(key))) {
      issues.push({ field: key, message: `${key} must be an http or https URL` });
      continue;
    }

    if (EMAIL_KEYS.has(key) && !isLegalContactEmail(trimmed)) {
      issues.push({ field: key, message: `${key} must be an email address` });
    }
  }

  return issues;
}

/** formation-service legal-contact rule: exactly one `@`, not at either edge, no whitespace or control characters. */
export function isLegalContactEmail(value: string): boolean {
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001f\u007f]/.test(value)) {
    return false;
  }
  const at = value.indexOf('@');
  return at > 0 && at === value.lastIndexOf('@') && at < value.length - 1;
}

/** http(s) URL check; `requireHost` mirrors the repository rule (the website rule does not require one). */
export function isHttpUrl(value: string, requireHost: boolean): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return false;
  }
  return !requireHost || parsed.hostname.length > 0;
}

function isCanonicalKey(key: string): boolean {
  return key in PROJECT_APPLICATION_FIELD_LABELS && key !== 'parent_project_uid';
}

function containsNul(value: unknown): boolean {
  if (typeof value === 'string') {
    return value.includes('\u0000');
  }
  if (Array.isArray(value)) {
    return value.some((entry) => containsNul(entry));
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).some(([key, entry]) => key.includes('\u0000') || containsNul(entry));
  }
  return false;
}
