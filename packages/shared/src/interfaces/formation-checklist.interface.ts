// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { ButtonSeverity, TagSeverity } from './components.interface';
import type {
  FormationActivity,
  FormationItem,
  FormationItemStatus,
  FormationQueueRow,
  FormationSubStage,
  FormationTemplateSection,
} from './formation.interface';

/**
 * The readiness strip's per-item segment bar and status tally — everything
 * `deriveFormationReadinessSummary` computes client-side from the raw item list.
 * `isActivating`/`openGatingItems`/`totalGatingItems` are not part of this shape: they come
 * straight from the server (`Formation.is_activating`/`gating_items_open`/`gating_items_total`),
 * so consumers read those off the formation directly instead of through this interface.
 */
export interface FormationReadinessSummary {
  /** One entry per checklist item, in template order — the literal per-item segment bar (not a 2-color fill/total bar). */
  segments: FormationItemStatus[];
  totalItems: number;
  counts: Record<FormationItemStatus, number>;
}

/** `FormationEntryCardComponent`'s loaded-summary shape — the readiness tally plus the server's own gating counts, or `null` while loading/on error. */
export interface FormationEntryCardSummary {
  readiness: FormationReadinessSummary;
  openGatingItems: number;
  totalGatingItems: number;
}

/** `FormationItemDrawerComponent`'s lazy-loaded data shape — the empty-sentinel object doubles as both "not yet loaded" and "closed"; loading/error are tracked separately by the component. */
export interface FormationDrawerData {
  item: FormationItem | null;
  history: FormationActivity[];
}

/** `FormationsTableComponent`'s emitted filter state — also the shape `FormationService.getFormationsQueue` accepts. */
export interface FormationsQueueFilterState {
  subStage: FormationSubStage | undefined;
  search: string;
}

/** `FormationChecklistSectionComponent`'s top-level view state. */
export type FormationChecklistPageState = 'loading' | 'error' | 'no-template' | 'no-items' | 'ready';

/** One template section plus the checklist items bucketed under it — `FormationChecklistSectionComponent`'s render unit, built by `groupFormationItemsBySection`. */
export interface FormationRenderedSection {
  section: FormationTemplateSection;
  items: FormationItem[];
}

/**
 * `FormationChecklistRowComponent`'s `#gatedAction` `<ng-template>` context — one entry per
 * `provisionable`/`request` action kind. `testidPrefix` carries the full `data-testid` prefix (not
 * a bare suffix) so it stays greppable from the value that produces it, per GH-1958 review.
 * `severity` is the non-optional `ButtonSeverity` (not `ButtonProps['severity']`, which admits
 * `null`/`undefined`) so a config can't null out severity — a mistyped literal was already
 * rejected by `satisfies` before this narrowing.
 */
export interface FormationRowActionConfig {
  testidPrefix: string;
  label: string;
  severity: ButtonSeverity;
  outlined: boolean;
}

/**
 * `FormationChecklistRowComponent`'s `#externalLinkAction` `<ng-template>` context — one entry per
 * `link`/`status_only` action kind. See `FormationRowActionConfig` for the `testidPrefix` rationale.
 */
export interface FormationLinkRowActionConfig {
  testidPrefix: string;
}

/**
 * `FormationsTableComponent`'s render row — {@link FormationQueueRow} plus the pre-resolved stage
 * chip label/severity/gating summary, so the `#body` template (where PrimeNG types the row context
 * `any`) does a plain property read instead of a method call that re-executes on every
 * change-detection pass.
 *
 * GH-2267 gap 2: previously extended `Formation` (which carried `gating_items_open`/
 * `gating_items_total`/`parent_formation_name`/`subtitle`) — the real indexed queue projection
 * doesn't publish any of those, so this now extends {@link FormationQueueRow} instead and derives
 * the gating "N of M" summary from `progress` + `gates_cleared`. The one-level indentation this
 * used to drive off `parent_formation_name` has no data source upstream and is dropped with it —
 * the Type column (from `deriveFormationEntityType`, unaffected by this gap) still distinguishes a
 * `child_project` row, just without visual indentation.
 */
export interface FormationTableRow extends FormationQueueRow {
  stageLabel: string;
  stageSeverity: TagSeverity;
  entityTypeLabel: string;
  /** `progress.done` — the completed count for the "N of M" gating summary. */
  doneCount: number;
  /** Sum of every `progress` bucket — the "M" in the "N of M" gating summary. */
  totalCount: number;
}

/**
 * `FormationChecklistRowComponent`'s status-menu output payload for the two "plain" transitions
 * that carry no extra data — `blocked` rides on its own `blockRequested` output instead (it needs
 * an optional note via `ReasonPromptDialogComponent`), and completion rides on `completeRequested`.
 */
export interface FormationRowStatusChange {
  item: FormationItem;
  status: Extract<FormationItemStatus, 'not_started' | 'in_progress'>;
}
