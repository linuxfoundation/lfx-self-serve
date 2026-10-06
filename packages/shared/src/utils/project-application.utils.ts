// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  PROJECT_APPLICATION_BOOLEAN_KEYS,
  PROJECT_APPLICATION_CANONICAL_KEYS,
  PROJECT_APPLICATION_CREATED_LEGAL_ENTITY_TYPE,
  PROJECT_APPLICATION_CREATED_STAGE,
  PROJECT_APPLICATION_EMAIL_KEYS,
  PROJECT_APPLICATION_EMAIL_LIST_KEYS,
  PROJECT_APPLICATION_FIELD_LABELS,
  PROJECT_APPLICATION_LONG_TEXT_KEYS,
  PROJECT_APPLICATION_MAILTO_FORBIDDEN_CHARS_REGEX,
  PROJECT_APPLICATION_SECTIONS,
  PROJECT_APPLICATION_SPEC_CATEGORY,
  PROJECT_APPLICATION_STATE_META,
  PROJECT_APPLICATION_STATUS_CALLOUTS,
  PROJECT_APPLICATION_UNKNOWN_STATE_META,
  PROJECT_APPLICATION_URL_KEYS,
  PROJECT_APPLICATION_URL_KEYS_REQUIRING_HOST,
} from '../constants/project-application.constants';
import type {
  ProjectApplication,
  ProjectApplicationAnswerKind,
  ProjectApplicationAnswerLink,
  ProjectApplicationAnswerRow,
  ProjectApplicationAnswers,
  ProjectApplicationAnswerSection,
  ProjectApplicationRow,
  ProjectApplicationStateMeta,
  ProjectApplicationStatusCallout,
  ProjectApplicationValidationIssue,
  ProjectApplicationViewMode,
  UpstreamProjectApplication,
  UpstreamProjectApplicationDoc,
} from '../interfaces/project-application.interface';
import type { CreateProjectRequest } from '../interfaces/project.interface';
import { slugify } from './string.utils';

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

/** Label + tag severity for a state; an unseen state renders its humanized value rather than breaking. */
export function getProjectApplicationStateMeta(state: string | null | undefined): ProjectApplicationStateMeta {
  if (!state) {
    return PROJECT_APPLICATION_UNKNOWN_STATE_META;
  }
  return PROJECT_APPLICATION_STATE_META[state] ?? { ...PROJECT_APPLICATION_UNKNOWN_STATE_META, label: humanizeProjectApplicationKey(state) };
}

/** Display name for an application: its proposed project name, or a placeholder. */
export function getProjectApplicationDisplayName(application: Pick<ProjectApplication, 'application'> | null | undefined): string {
  const name = application?.application?.project_name;
  return typeof name === 'string' && name.trim() ? name.trim() : 'Untitled proposal';
}

/** Decorates an application with the display values the list renders. */
export function toProjectApplicationRow(application: ProjectApplication): ProjectApplicationRow {
  const meta = getProjectApplicationStateMeta(application.state);
  return { ...application, displayName: getProjectApplicationDisplayName(application), stateLabel: meta.label, stateSeverity: meta.severity };
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
        return buildProjectApplicationAnswerRow(key, source[key]);
      })
      .filter((row) => row.value !== '');
    if (rows.length > 0) {
      sections.push({ title: section.title, rows: hideRedundantLabel(section.title, rows) });
    }
  }

  const otherRows = Object.keys(source)
    .filter((key) => !known.has(key))
    .sort()
    .map((key) => buildProjectApplicationAnswerRow(key, source[key]))
    .filter((row) => row.value !== '');
  if (otherRows.length > 0) {
    sections.push({ title: 'Other answers', rows: otherRows });
  }

  return sections;
}

/** One answer as the detail view renders it: URL and email answers carry their entries as links. */
export function buildProjectApplicationAnswerRow(key: string, raw: unknown): ProjectApplicationAnswerRow {
  const value = formatProjectApplicationAnswer(raw);
  const kind = getProjectApplicationAnswerKind(key);
  return {
    key,
    label: getProjectApplicationFieldLabel(key),
    value,
    kind,
    links: value ? toProjectApplicationAnswerLinks(kind, raw, value) : [],
    long: PROJECT_APPLICATION_LONG_TEXT_KEYS.has(key),
    labelHidden: false,
  };
}

/** Link target for a URL answer — only an absolute http(s) URL with a host is linked; anything else stays text. */
export function toProjectApplicationUrlLink(text: string): ProjectApplicationAnswerLink {
  return { text, href: isHttpUrl(text, true) ? text : null, external: true };
}

/**
 * Link target for an email answer. Only a plain single address becomes a `mailto:` link — stricter than the
 * stored-value rules, so a legacy entry carrying `?`, `&` or other mailto-header characters stays text.
 */
export function toProjectApplicationEmailLink(text: string): ProjectApplicationAnswerLink {
  return { text, href: isPlainEmailAddress(text) ? `mailto:${text}` : null, external: false };
}

/** One `@` between a non-empty local part and a dotted domain, with no forbidden characters — checked without backtracking. */
function isPlainEmailAddress(text: string): boolean {
  if (PROJECT_APPLICATION_MAILTO_FORBIDDEN_CHARS_REGEX.test(text)) {
    return false;
  }
  const at = text.indexOf('@');
  if (at <= 0 || at !== text.lastIndexOf('@')) {
    return false;
  }
  const domain = text.slice(at + 1);
  const dot = domain.lastIndexOf('.');
  return dot > 0 && dot < domain.length - 1;
}

/** The state explainer for the detail drawer, worded for the persona viewing it; `null` for an unseen state. */
export function getProjectApplicationStatusCallout(state: string | null | undefined, mode: ProjectApplicationViewMode): ProjectApplicationStatusCallout | null {
  const copy = state ? PROJECT_APPLICATION_STATUS_CALLOUTS[state] : undefined;
  if (!copy) {
    return null;
  }
  return { severity: copy.severity, icon: copy.icon, text: mode === 'staff' ? copy.staff : copy.submitter };
}

function getProjectApplicationAnswerKind(key: string): ProjectApplicationAnswerKind {
  if (PROJECT_APPLICATION_URL_KEYS.has(key)) {
    return 'url';
  }
  if (PROJECT_APPLICATION_EMAIL_KEYS.has(key)) {
    return 'email';
  }
  if (PROJECT_APPLICATION_EMAIL_LIST_KEYS.has(key)) {
    return 'email-list';
  }
  return 'text';
}

function toProjectApplicationAnswerLinks(kind: ProjectApplicationAnswerKind, raw: unknown, value: string): ProjectApplicationAnswerLink[] {
  switch (kind) {
    case 'url':
      return [toProjectApplicationUrlLink(value)];
    case 'email':
      return [toProjectApplicationEmailLink(value)];
    case 'email-list': {
      const entries = Array.isArray(raw) ? raw.map((entry) => formatProjectApplicationAnswer(entry)) : value.split(',');
      return entries
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => toProjectApplicationEmailLink(entry));
    }
    default:
      return [];
  }
}

/** A one-answer section whose label repeats the section title shows the label to screen readers only. */
function hideRedundantLabel(title: string, rows: ProjectApplicationAnswerRow[]): ProjectApplicationAnswerRow[] {
  if (rows.length === 1 && rows[0].label === title) {
    return [{ ...rows[0], labelHidden: true }];
  }
  return rows;
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

    if (PROJECT_APPLICATION_BOOLEAN_KEYS.has(key)) {
      if (typeof value !== 'boolean') {
        issues.push({ field: key, message: `${key} must be true or false` });
      }
      continue;
    }

    if (PROJECT_APPLICATION_EMAIL_LIST_KEYS.has(key)) {
      if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || !isFormationContactEmail(entry))) {
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

    if (PROJECT_APPLICATION_URL_KEYS.has(key) && !isHttpUrl(trimmed, PROJECT_APPLICATION_URL_KEYS_REQUIRING_HOST.has(key))) {
      issues.push({ field: key, message: `${key} must be an http or https URL` });
      continue;
    }

    // Checked untrimmed, as upstream does: surrounding whitespace is refused there too.
    if (PROJECT_APPLICATION_EMAIL_KEYS.has(key) && !isLegalContactEmail(value)) {
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

/**
 * formation-service's formation-contact rule, kept deliberately shallow for legacy payloads: after trimming,
 * the first `@` is at neither edge and there is no space. The intake form applies a stricter check to new input;
 * this one must not, or a stored application with a legacy entry could never be revised or accepted.
 */
export function isFormationContactEmail(value: string): boolean {
  const trimmed = value.trim();
  const at = trimmed.indexOf('@');
  return at > 0 && at < trimmed.length - 1 && !trimmed.includes(' ');
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
  return (PROJECT_APPLICATION_CANONICAL_KEYS as readonly string[]).includes(key);
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

/**
 * Maps an accepted application onto project-service's create body (#1995). Blank optional answers are left out
 * rather than sent empty — the URL fields are `format: uri` upstream. Answers project-service has no field for
 * (trademark, contributing organization, contacts, license, chat, CLA/DCO) stay on the application only.
 */
export function buildCreateProjectRequest(answers: ProjectApplicationAnswers, parentProjectUid: string, slug: string): CreateProjectRequest {
  const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
  const request: CreateProjectRequest = {
    name: text(answers.project_name),
    slug,
    description: text(answers.description),
    parent_uid: parentProjectUid,
    stage: PROJECT_APPLICATION_CREATED_STAGE,
    legal_entity_type: PROJECT_APPLICATION_CREATED_LEGAL_ENTITY_TYPE,
  };

  const missionStatement = text(answers.mission_statement);
  const repositoryUrl = text(answers.project_repository_url);
  const websiteUrl = text(answers.project_website);
  if (missionStatement) {
    request.mission_statement = missionStatement;
  }
  if (repositoryUrl) {
    request.repository_url = repositoryUrl;
  }
  if (websiteUrl) {
    request.website_url = websiteUrl;
  }
  if (answers.is_spec_project === true) {
    request.category = PROJECT_APPLICATION_SPEC_CATEGORY;
  }
  return request;
}

/**
 * Suggested project slug for a proposed project name: `slugify`, with any leading digits or separators dropped
 * because project-service slugs must start with a letter. Returns `''` when nothing usable remains.
 */
export function projectSlugFromName(name: string | null | undefined): string {
  return slugify(name ?? '').replace(/^[^a-z]+/, '');
}
