// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { PROJECT_APPLICATION_TABS } from '../constants/project-application.constants';
import type { MessageSeverity, TagSeverity } from './components.interface';
import type { Project } from './project.interface';

/**
 * Where an application stands (#3037). `submitted`, `withdrawn`, `accepted` and `denied` are the agreed wire
 * values; formation-service deliberately publishes no closed enum, so an unseen value must still render
 * rather than break the list — hence the `string` widening.
 */
export type ProjectApplicationState = 'submitted' | 'withdrawn' | 'accepted' | 'denied' | (string & {});

/** Who is looking at an application: the submitter's own list, or the formation team's review queue. */
export type ProjectApplicationViewMode = 'submitter' | 'staff';

/** formation-service state-transition routes under `/project-applications/{uid}/`. */
export type ProjectApplicationAction = 'withdraw' | 'accept' | 'deny';

/** Page-level tab ids on My Formations and the foundation Formations queue. */
export type ProjectApplicationTab = (typeof PROJECT_APPLICATION_TABS)[keyof typeof PROJECT_APPLICATION_TABS];

/**
 * The intake answers, keyed by formation-service's canonical keys. Every key is optional to the backend — the
 * UI decides which are required. The index signature keeps keys this UI doesn't know about (a newer form, a
 * staff-set `parent_project_uid`) so a revise, which replaces the whole map, never drops them.
 */
export interface ProjectApplicationAnswers {
  project_name?: string;
  project_repository_url?: string;
  project_website?: string;
  trademark_status?: string;
  contributing_organization?: string;
  legal_contact_email?: string;
  formation_list?: string[];
  license?: string;
  chat_platform?: string;
  mission_statement?: string;
  agreement_type?: string;
  is_spec_project?: boolean;
  description?: string;
  /** Parent project the formation team chose at accept time; recorded by the BFF before it creates the project. */
  parent_project_uid?: string;
  /** Slug the formation team chose for the project created at accept time (#1995). */
  project_slug?: string;
  /** UID of the project created at accept time; lets a retried accept skip creating it again (#1995). */
  project_uid?: string;
  [key: string]: unknown;
}

/** An application as the BFF returns it to the browser — the query document normalized onto `uid`. */
export interface ProjectApplication {
  uid: string;
  state: ProjectApplicationState;
  /** Echo as `If-Match` on every mutation. */
  revision: number;
  submitter_username: string;
  submitter_name: string;
  submitter_email: string;
  /** A hint only — never a placement and never an access grant. */
  target_parent_uid: string | null;
  application: ProjectApplicationAnswers;
  created_at: string;
  updated_at: string;
}

/**
 * The query-service document for `type=project_application` (formation-service `applicationProjectionWire`).
 * `object_id` is the application UID.
 */
export interface UpstreamProjectApplicationDoc {
  object_id: string;
  state: string;
  revision: number;
  submitter_username: string;
  submitter_name: string;
  submitter_email: string;
  project_name?: string;
  application?: ProjectApplicationAnswers | null;
  target_parent_uid?: string | null;
  created_at: string;
  updated_at: string;
}

/** The formation-service `ProjectApplication` result (create, revise, withdraw, accept, deny bodies). */
export interface UpstreamProjectApplication {
  uid: string;
  state: string;
  revision: number;
  submitter_username: string;
  submitter_name: string;
  submitter_email: string;
  target_parent_uid?: string | null;
  application?: ProjectApplicationAnswers | null;
  created_at: string;
  updated_at: string;
}

/** Browser → BFF create body. The BFF adds the signed-in identity; the browser never sends it. */
export interface CreateProjectApplicationRequest {
  application: ProjectApplicationAnswers;
}

/** BFF → formation-service create body. */
export interface UpstreamCreateProjectApplicationRequest {
  submitter_username: string;
  submitter_name: string;
  submitter_email: string;
  application: ProjectApplicationAnswers;
}

/** Browser → BFF revise body: the COMPLETE answer map, which replaces what is stored. */
export interface ReviseProjectApplicationRequest {
  application: ProjectApplicationAnswers;
}

/**
 * Browser → BFF accept body. Accept upstream takes no body, so the BFF first revises `application` with
 * `parent_project_uid` and `project_slug` added, creates the project under that parent (#1995), records its
 * `project_uid`, then accepts at the latest revision.
 */
export interface AcceptProjectApplicationRequest {
  parent_project_uid: string;
  project_slug: string;
  application: ProjectApplicationAnswers;
}

/** BFF response for every mutation that returns the application. */
export interface ProjectApplicationWriteResult {
  application: ProjectApplication;
  /** Next revision, as the upstream `ETag` header carried it; `null` when upstream omitted it. */
  etag: string | null;
}

/** BFF `GET /api/project-applications/access` — whether the caller may see the review queue. */
export interface ProjectApplicationAccess {
  is_formation_team: boolean;
}

/** Display metadata for one application state. */
export interface ProjectApplicationStateMeta {
  label: string;
  severity: TagSeverity;
}

/** One labelled option for the intake form's select / select-button controls. */
export interface ProjectApplicationOption<T = string> {
  label: string;
  value: T;
}

/** One detail-view section: its title and the answer keys it groups, in order. */
export interface ProjectApplicationSectionConfig {
  title: string;
  keys: string[];
}

/** A list row with its display values precomputed, so templates only read fields. */
export interface ProjectApplicationRow extends ProjectApplication {
  displayName: string;
  stateLabel: string;
  stateSeverity: TagSeverity;
}

/** Data handed to the accept dialog. */
export interface ProjectApplicationAcceptDialogData {
  projectName: string;
  /** Slug an earlier, failed accept recorded; prefilled so a retry keeps the project that may already exist. */
  projectSlug?: string;
}

/** What the accept dialog closes with: the parent the new project goes under, and its slug. */
export interface ProjectApplicationAcceptChoice {
  parent: Project;
  slug: string;
}

/** How the detail view renders an answer: plain text, or one link per entry. */
export type ProjectApplicationAnswerKind = 'text' | 'url' | 'email' | 'email-list';

/** One linkable entry of a URL or email answer. `href` is `null` when the entry isn't a safe link target. */
export interface ProjectApplicationAnswerLink {
  text: string;
  href: string | null;
  /** Opens in a new tab — true for http(s) links, false for `mailto:`. */
  external: boolean;
}

/** A single answer rendered in the application detail view. */
export interface ProjectApplicationAnswerRow {
  key: string;
  label: string;
  value: string;
  kind: ProjectApplicationAnswerKind;
  /** The answer's entries as links; empty for a `text` answer, which renders `value`. */
  links: ProjectApplicationAnswerLink[];
  /** Long-form prose, rendered full width under its label rather than in the value column. */
  long: boolean;
  /** The label repeats the section title (a one-answer section), so it is shown to screen readers only. */
  labelHidden: boolean;
}

/** One titled group of answers in the application detail view. */
export interface ProjectApplicationAnswerSection {
  title: string;
  rows: ProjectApplicationAnswerRow[];
}

/** The state explainer shown under the detail drawer's header. */
export interface ProjectApplicationStatusCallout {
  severity: MessageSeverity;
  icon: string;
  text: string;
}

/** Status explainer copy per state, worded for each persona. */
export interface ProjectApplicationStatusCalloutCopy {
  severity: MessageSeverity;
  icon: string;
  submitter: string;
  staff: string;
}

/** Result of validating an answer map against the backend's canonical-field rules. */
export interface ProjectApplicationValidationIssue {
  field: string;
  message: string;
}
