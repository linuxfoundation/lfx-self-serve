// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ProjectStage } from '../enums/project-stage.enum';
import type { StatCardItem } from '../interfaces/stat-card.interface';
import type { TagSeverity } from '../interfaces/components.interface';
import type {
  FormationPipelineSort,
  FormationPipelineSortKey,
  FormationPipelineStage,
  FormationPipelineStageFilter,
} from '../interfaces/formation-pipeline.interface';

/** Browser-facing BFF path of the pipeline read. */
export const FORMATION_PIPELINE_API_PATH = '/api/formations/pipeline';

/** Page-tab id and `?tab=` value of the Pipeline tab on the LF-root Formations page. */
export const FORMATION_PIPELINE_TAB_ID = 'pipeline';

/** Every pipeline stage key, in display order. `Active` is never a pipeline stage. */
export const FORMATION_PIPELINE_STAGES: readonly FormationPipelineStage[] = [
  'prospect',
  'exploratory',
  'engaged',
  'on_hold',
  'disengaged',
  'confidential',
  'archived',
];

/** Upstream `stage` value for each pipeline stage key; the BFF's `filters_or=stage:<value>` and the row mapping both read this. */
export const FORMATION_PIPELINE_STAGE_UPSTREAM: Record<FormationPipelineStage, ProjectStage> = {
  prospect: ProjectStage.Prospect,
  exploratory: ProjectStage.FormationExploratory,
  engaged: ProjectStage.FormationEngaged,
  on_hold: ProjectStage.FormationOnHold,
  disengaged: ProjectStage.FormationDisengaged,
  confidential: ProjectStage.FormationConfidential,
  archived: ProjectStage.Archived,
};

/**
 * What the pipeline calls a `Prospect` project. A project created in PCC and not yet being explored shows as "Draft"
 * there; kept as the single label so a different answer from the formation team is a one-line change.
 */
export const FORMATION_PIPELINE_PROSPECT_LABEL = 'Draft';

/** Display label per pipeline stage. */
export const FORMATION_PIPELINE_STAGE_LABELS: Record<FormationPipelineStage, string> = {
  prospect: FORMATION_PIPELINE_PROSPECT_LABEL,
  exploratory: 'Exploratory',
  engaged: 'Engaged',
  on_hold: 'On hold',
  disengaged: 'Disengaged',
  confidential: 'Confidential',
  archived: 'Archived',
};

/** Stage tag tone; Exploratory/Engaged/On hold follow `FORMATION_SUB_STAGE_SEVERITY` on the existing queue. */
export const FORMATION_PIPELINE_STAGE_SEVERITY: Record<FormationPipelineStage, TagSeverity> = {
  prospect: 'secondary',
  exploratory: 'info',
  engaged: 'accent',
  on_hold: 'warn',
  disengaged: 'secondary',
  confidential: 'secondary',
  archived: 'secondary',
};

/** The live pipeline: what the formation team is actively working. The default view; Disengaged, Confidential and Archived are opt-in. */
export const FORMATION_PIPELINE_LIVE_STAGES: readonly FormationPipelineStage[] = ['prospect', 'exploratory', 'engaged', 'on_hold'];

/** The stage selection the page opens on. */
export const FORMATION_PIPELINE_DEFAULT_STAGE: FormationPipelineStageFilter = 'in_pipeline';

/** Stages whose pill shows only while they hold at least one row. */
export const FORMATION_PIPELINE_HIDE_WHEN_EMPTY_STAGES: readonly FormationPipelineStage[] = ['disengaged', 'confidential'];

/** Stages that get a stat card, in order. Disengaged and Confidential have pills only. */
export const FORMATION_PIPELINE_STAT_STAGES: readonly FormationPipelineStage[] = ['prospect', 'exploratory', 'engaged', 'on_hold', 'archived'];

/** Stat card icon and icon-container classes per stat stage. */
export const FORMATION_PIPELINE_STAT_CARD_STYLE: Record<string, Pick<StatCardItem, 'icon' | 'iconContainerClass'>> = {
  prospect: { icon: 'fa-light fa-pen-ruler', iconContainerClass: 'bg-slate-100 text-slate-600' },
  exploratory: { icon: 'fa-light fa-magnifying-glass', iconContainerClass: 'bg-blue-100 text-blue-600' },
  engaged: { icon: 'fa-light fa-handshake', iconContainerClass: 'bg-sky-100 text-sky-600' },
  on_hold: { icon: 'fa-light fa-circle-pause', iconContainerClass: 'bg-amber-100 text-amber-600' },
  archived: { icon: 'fa-light fa-box-archive', iconContainerClass: 'bg-slate-100 text-slate-500' },
};

/** Static stat-card captions. */
export const FORMATION_PIPELINE_STAT_CAPTIONS = {
  prospect: 'Created in PCC, not yet exploring',
  on_hold: 'Paused by the formation team',
  archived: 'Did not launch',
} as const;

/** A launch inside this many days is flagged amber. */
export const FORMATION_PIPELINE_LAUNCH_SOON_DAYS = 30;

/** Default table sort: upcoming launches soonest first, then past ones, then unset. */
export const FORMATION_PIPELINE_DEFAULT_SORT: FormationPipelineSort = { key: 'expected_launch', direction: 'asc' };

/** Table rows per page. */
export const FORMATION_PIPELINE_PAGE_SIZE = 25;

/** All copy of the Pipeline tab: description, filter and export labels, empty and error states. */
export const FORMATION_PIPELINE_COPY = {
  description: 'Every project the formation team is bringing into The Linux Foundation, by stage.',
  notSet: 'Not set',
  allStages: 'All',
  inPipeline: 'In pipeline',
  overdue: 'Overdue',
  allFoundations: 'All foundations',
  searchPlaceholder: 'Search projects',
  exportLabel: 'Export CSV',
  emptyTitle: 'No pipeline projects yet',
  emptySubtitle: 'Projects between Draft and Active will appear here.',
  filteredEmptyTitle: 'No projects match',
  filteredEmptySubtitle: 'Try a different stage, foundation or search.',
  errorMessage: "Couldn't load the pipeline. Try again.",
  forbiddenMessage: 'Only the formation team can see the pipeline.',
  retry: 'Retry',
  noPm: 'No PM yet',
  notAssigned: 'Not assigned',
} as const;

/** Column headers, in display order. */
export const FORMATION_PIPELINE_COLUMNS: readonly { key: FormationPipelineSortKey; label: string }[] = [
  { key: 'project', label: 'Project' },
  { key: 'stage', label: 'Stage' },
  { key: 'expected_launch', label: 'Expected launch' },
  { key: 'formation_date', label: 'Formation date' },
  { key: 'legal_entity', label: 'Legal entity' },
  { key: 'ed_pm', label: 'ED / PM' },
  { key: 'opportunity_owner', label: 'Opportunity owner' },
  { key: 'updated', label: 'Updated' },
];

/** `formation-pipeline-YYYY-MM-DD.csv` filename prefix and extension. */
export const FORMATION_PIPELINE_CSV_FILENAME_PREFIX = 'formation-pipeline-';

/** How far up the parent chain a foundation-scoped pipeline read walks before giving up; a real hierarchy is a handful deep. */
export const FORMATION_PIPELINE_MAX_ANCESTRY_DEPTH = 8;

/** Longest `q` name search the pipeline API accepts. */
export const FORMATION_PIPELINE_SEARCH_MAX_LENGTH = 100;
