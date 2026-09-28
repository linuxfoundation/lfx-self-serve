// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { PROJECT_APPLICATION_TABS } from '../constants/project-application.constants';
import type { TagSeverity } from './components.interface';

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
  /** Parent project the formation team chose at accept time; written by the BFF's revise-then-accept. */
  parent_project_uid?: string;
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
 * `parent_project_uid` added, then accepts at the revision that revise returned.
 */
export interface AcceptProjectApplicationRequest {
  parent_project_uid: string;
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
}

/** A single answer rendered in the application detail view. */
export interface ProjectApplicationAnswerRow {
  key: string;
  label: string;
  value: string;
}

/** One titled group of answers in the application detail view. */
export interface ProjectApplicationAnswerSection {
  title: string;
  rows: ProjectApplicationAnswerRow[];
}

/** Result of validating an answer map against the backend's canonical-field rules. */
export interface ProjectApplicationValidationIssue {
  field: string;
  message: string;
}
