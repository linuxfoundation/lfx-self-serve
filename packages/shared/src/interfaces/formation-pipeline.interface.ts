// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { TagSeverity } from './components.interface';
import type { ProjectFunding } from '../enums/project-funding.enum';
import type { ProjectApplicationTab } from './project-application.interface';
import type { UserInfo } from './project.interface';

/** Short stage keys the pipeline API and UI use; one per non-`Active` {@link ProjectStage}. */
export type FormationPipelineStage = 'prospect' | 'exploratory' | 'engaged' | 'on_hold' | 'disengaged' | 'confidential' | 'archived';

/** Stage pill/stat-card selection: one stage, `in_pipeline` (the live stages: Draft, Exploratory, Engaged, On hold), or `all`. */
export type FormationPipelineStageFilter = FormationPipelineStage | 'in_pipeline' | 'all';

/** Where a project stands against foundations (#5619): `new_foundation` is itself one (`computeIsFoundation`, test projects excluded), `under_foundation` has a foundation ancestor, `no_foundation` is neither. */
export type FormationPipelineFoundationKind = 'new_foundation' | 'under_foundation' | 'no_foundation';

/** Foundation-type selection: one kind, or `all`. */
export type FormationPipelineFoundationKindFilter = FormationPipelineFoundationKind | 'all';

/** Per-stage row counts plus the total, taken before any stage selection or UI search. */
export type FormationPipelineCounts = Record<FormationPipelineStage, number> & { total: number };

/** A person as the pipeline serves them — only what query-service returned for this caller. */
export type FormationPipelinePerson = Pick<UserInfo, 'name' | 'email' | 'username'>;

/** The foundation a pipeline row belongs to: its nearest ancestor that `computeIsFoundation` classifies as one, which need not be its direct parent. */
export interface FormationPipelineParent {
  uid: string;
  name: string;
}

/** One pipeline row as `GET /api/formations/pipeline` serves it. Dates are ISO strings; empty means "not set". */
export interface FormationPipelineRow {
  uid: string;
  slug: string;
  name: string;
  stage: FormationPipelineStage;
  /** The nearest foundation ancestor, or `null` when the project has none (top-level, or an ancestor query-service did not return). */
  parent: FormationPipelineParent | null;
  /** A row that is itself a foundation is `new_foundation` whatever its ancestors; otherwise `under_foundation` when `parent` is set, else `no_foundation`. */
  foundation_kind: FormationPipelineFoundationKind;
  announcement_date: string | null;
  formation_date: string | null;
  legal_entity_name: string | null;
  legal_entity_type: string | null;
  executive_director: FormationPipelinePerson | null;
  program_manager: FormationPipelinePerson | null;
  opportunity_owner: FormationPipelinePerson | null;
  /** The project's Formation Lead (`project_settings.formation_lead`); `null` when unset or the field is not served yet. */
  formation_lead: FormationPipelinePerson | null;
  created_at: string | null;
  updated_at: string | null;
  /** True when a `formation` checklist document exists for the project, in any lifecycle (a frozen one counts). */
  has_checklist: boolean;
}

/** `GET /api/formations/pipeline` response. `counts` ignore the `stage` parameter (they cover the foundation and `q` scope); the page recomputes its own over the rows after its client-side name search. */
export interface FormationPipelineResponse {
  rows: FormationPipelineRow[];
  counts: FormationPipelineCounts;
}

/** Query parameters of `GET /api/formations/pipeline`, after validation. */
export interface FormationPipelineQuery {
  stages: FormationPipelineStage[];
  foundationUid?: string;
  search?: string;
}

/** Columns the pipeline table can sort by. */
export type FormationPipelineSortKey =
  | 'project'
  | 'stage'
  | 'expected_launch'
  | 'formation_lead'
  | 'formation_date'
  | 'legal_entity'
  | 'ed_pm'
  | 'opportunity_owner'
  | 'updated';

export type FormationPipelineSortDirection = 'asc' | 'desc';

export interface FormationPipelineSort {
  key: FormationPipelineSortKey;
  direction: FormationPipelineSortDirection;
}

/** The Pipeline's filter and sort state as it lives in the URL (#5619): stage, foundation, foundation type, name search and sort. */
export interface FormationPipelineUrlState {
  stage: FormationPipelineStageFilter;
  /** The chosen foundation's uid, or `null` for all foundations. */
  foundationUid: string | null;
  foundationKind: FormationPipelineFoundationKindFilter;
  search: string;
  sort: FormationPipelineSort;
}

/** What the "Expected launch" cell shows for one date. */
export interface FormationPipelineLaunch {
  /** Formatted date, or the "Not set" copy. */
  dateLabel: string;
  /** "In 8 days" / "In 9 weeks"; empty when the date is unset or already past. */
  relativeLabel: string;
  /** True when the launch is within the next 30 days. */
  soon: boolean;
  /** True when the date has passed and the project is not Archived: shown as "Overdue", amber like `soon`. */
  overdue: boolean;
}

/** Upstream `project` index document fields the pipeline reads. */
export interface UpstreamPipelineProject {
  uid: string;
  slug: string;
  name: string;
  stage?: string;
  parent_uid?: string;
  /** With `stage`, `legal_entity_type` and `funding_model`, what `computeIsFoundation` classifies an ancestor by; `is_foundation` is not stored on the index document. */
  funding?: ProjectFunding;
  funding_model?: string[];
  formation_date?: string;
  legal_entity_name?: string;
  legal_entity_type?: string;
  created_at?: string;
  updated_at?: string;
}

/** Upstream `project_settings` index document fields the pipeline reads. */
export interface UpstreamPipelineSettings {
  uid: string;
  announcement_date?: string;
  executive_director?: UserInfo | null;
  program_manager?: UserInfo | null;
  opportunity_owner?: UserInfo | null;
  /** Added by lfx-v2-project-service#184; present once the v1 sync and backfill (lfx-v1-sync-helper#216) have run. */
  formation_lead?: UserInfo | null;
}

/** Page tabs of the LF-root Formations page: the pipeline, plus the existing formations and proposals tabs. */
export type FormationsQueuePageTab = 'pipeline' | ProjectApplicationTab;

/** Where a pipeline row opens: the formation checklist when it has one, else the project's own dashboard. */
export interface FormationPipelineRowLink {
  commands: string[];
  /** Query params to set; `null` keeps the current ones (`queryParamsHandling="preserve"`). */
  queryParams: Record<string, string> | null;
}

/** A {@link FormationPipelineRow} with its display strings resolved once, for the table and the phone card list. */
export interface FormationPipelineTableRow extends FormationPipelineRow {
  stageLabel: string;
  stageSeverity: TagSeverity;
  launch: FormationPipelineLaunch;
  formationDateLabel: string;
  legalEntityLabel: string;
  edLine: string;
  pmLine: string;
  /** The lead's name (email or username when there is no name), or the "Not set" copy. */
  formationLeadLabel: string;
  /** The lead's email for the hover/focus tooltip; `''` when none. */
  formationLeadEmail: string;
  ownerLabel: string;
  updatedLabel: string;
  link: FormationPipelineRowLink;
}
