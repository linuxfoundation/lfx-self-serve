// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { ButtonSeverity, TagSeverity } from './components.interface';
import type { Project } from './project.interface';
import type {
  FormationActivity,
  FormationItem,
  FormationItemStatus,
  FormationQueueRow,
  FormationSubStage,
  FormationTemplateSection,
} from './formation.interface';

/**
 * A per-entry segment bar and status tally — everything `deriveFormationReadinessSummary`
 * computes client-side from a list of status-bearing entries: the checklist's items for the
 * readiness strip, or one item's `sub_items` for the row disclosure and
 * `lfx-formation-sub-item-list` (#2774). `isActivating`/`openGatingItems`/`totalGatingItems` are
 * not part of this shape: they come straight from the server
 * (`Formation.is_activating`/`gating_items_open`/`gating_items_total`), so consumers read those off
 * the formation directly instead of through this interface.
 */
export interface FormationReadinessSummary {
  /** One entry per input entry, in the input list's order — the literal per-entry segment bar (not a 2-color fill/total bar). */
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

/**
 * Distinguishes why the History panel looks the way it does (GH-2372) — a genuinely-empty feed,
 * `complete`, must never look like `unavailable` (the activity fetch itself failed; the item
 * above is still valid). The upstream `item_uid` filter (GH-2572) removed the whole-feed scan this
 * once bounded, so there is no `truncated` state anymore — a filtered read either succeeds
 * (`complete`, however many entries) or fails (`unavailable`).
 */
export type FormationActivityHistoryState = 'complete' | 'unavailable';

/** `FormationItemDrawerComponent`'s lazy-loaded data shape — the empty-sentinel object doubles as both "not yet loaded" and "closed"; loading/error are tracked separately by the component. */
export interface FormationDrawerData {
  item: FormationItem | null;
  history: FormationActivity[];
  history_state: FormationActivityHistoryState;
}

/**
 * `FormationService.getFormationItemDetail`'s (BFF) response shape (GH-2372) — same fields as
 * {@link FormationDrawerData} but `item` is never `null`: the drawer's own empty-sentinel state has
 * no server-side equivalent, since `getFormationItemDetail` either returns a real item or throws
 * (mirroring {@link FormationDrawerData}'s comment, not duplicating its history-state doc).
 */
export interface FormationItemDetail {
  item: FormationItem;
  history: FormationActivity[];
  history_state: FormationActivityHistoryState;
}

/** `FormationsTableComponent`'s emitted filter state — also the shape `FormationService.getFormationsQueue` accepts. */
export interface FormationsQueueFilterState {
  subStage: FormationSubStage | undefined;
  search: string;
}

/**
 * Where a formation's announcement date sits relative to today, for the queue's countdown line
 * (`getFormationAnnouncementTiming`). `unset` covers both a missing date and one that fails to
 * parse. `needed` is `unset` while `gates_cleared` is true: every gating item is done, so the
 * missing date is now the only thing between the formation and Active (upstream's `is_activating`
 * requires one) — the one "unset" that deserves a prompt rather than a muted dash.
 */
export type FormationAnnouncementTiming = 'past' | 'today' | 'upcoming' | 'unset' | 'needed';

/**
 * One proportional segment of the queue's per-row progress bar (`buildFormationProgressSegments`)
 * — a status bucket with a non-zero count, in `FORMATION_PROGRESS_SEGMENT_RANK` order. Distinct from
 * {@link FormationReadinessSummary.segments}, which is one entry per item in template order: the
 * queue projection only carries per-status counts, so it renders one width-weighted segment per
 * status instead of one per item.
 */
export interface FormationProgressSegment {
  status: FormationItemStatus;
  count: number;
  /** `count / total * 100`, unrounded — bound straight to `[style.width.%]`. */
  widthPercent: number;
  /** `FORMATION_ITEM_SEGMENT_COLORS[status]`, resolved once here so the template does a property read. */
  colorClass: string;
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
 * `FORMATION_ITEM_STATUS_GLYPHS`'s value shape (#2774) — the FontAwesome class and Tailwind text
 * color `lfx-formation-sub-item-list` leads each sub-item row with.
 */
export interface FormationItemStatusGlyph {
  icon: string;
  colorClass: string;
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
 * used to drive off `parent_formation_name` has no data source upstream and was dropped with it,
 * as was the Type column itself (LFXV2-3386). {@link entityTypeLabel} is not that column coming
 * back: it is a sub-line derived live from `is_foundation`/`parent_uid` via
 * `deriveFormationEntityType` — the same derivation the "N foundations · N projects" tile already
 * trusts — not a read of the unpublished `parent_formation_name`.
 */
export interface FormationTableRow extends FormationQueueRow {
  stageLabel: string;
  stageSeverity: TagSeverity;
  /** `FORMATION_ENTITY_TYPE_LABELS[deriveFormationEntityType(row)]` — "Foundation" / "Project" / "Child project", the name cell's sub-line. */
  entityTypeLabel: string;
  /** `formatAnnouncementDateLabel(announcement_date)` — e.g. "Jul 14, 2026", or "Not set". */
  announcementLabel: string;
  /** The date line's text-colour class — muted for a plain `unset`, so an absent date reads as absence rather than as data. */
  announcementLabelClass: string;
  announcementTiming: FormationAnnouncementTiming;
  /**
   * The Announcement cell's second line: `formatFormationAnnouncementCountdown` ("182 days ago" /
   * "Today" / "In 42 days"), `FORMATION_ANNOUNCEMENT_NEEDED_LABEL` for a `needed` timing, or `null`
   * for a plain `unset`.
   */
  announcementDetail: string | null;
  /** `FORMATION_ANNOUNCEMENT_TIMING_CLASS[announcementTiming]` — the second line's text-colour class. */
  announcementDetailClass: string;
  /** `progress.done + progress.skipped` — the completed count for the "N of M" summary (a skipped item is resolved, not remaining work). */
  doneCount: number;
  /** Sum of every `progress` bucket — the "M" in the "N of M" summary. */
  totalCount: number;
  /** `buildFormationProgressSegments(progress)` — empty for a `0 of 0` row, which renders an empty track. */
  progressSegments: FormationProgressSegment[];
  /** `formatFormationProgressSummary(progress)` — the bar's `aria-label` and tooltip, e.g. "17 items · 3 done · 1 in progress · 2 blocked · 11 not started". */
  progressSummary: string;
  /** `blocked_item_titles.length` — `0` renders the Blocking cell's "Gates cleared" chip or dash instead. */
  blockedCount: number;
  /** "N blocked" — the Blocking cell's danger chip label; `''` when nothing is blocked. */
  blockedLabel: string;
  /** Every blocked title joined with " · " — the chip's tooltip, so a row with three blockers still lists all three. */
  blockedTitlesLabel: string;
  /** `blocked_item_titles[0] ?? null` — the single line under the chip. */
  firstBlockedTitle: string | null;
}

/**
 * `FormationDetailComponent`'s project-load state (LFXV2-3386). `error` is a transient failure
 * (gateway 5xx, network) with a Retry affordance; a 400/404 lands as `{ error: false,
 * project: null }` — the permanent not-found branch — following `newsletter-reader.component.ts`'s
 * classification so an outage never masquerades as a missing project.
 */
export interface FormationDetailPageState {
  loading: boolean;
  error: boolean;
  project: Project | null;
}

/**
 * `FormationChecklistRowComponent`'s status-menu output payload for the two transitions upstream
 * never requires a `reason` for (`in_progress`/`done`) — every other target
 * (`blocked`/`skipped`/`not_started`) always requires one and rides on `reasonedStatusRequested`
 * instead, which opens `ReasonPromptDialogComponent` first.
 */
export interface FormationRowStatusChange {
  item: FormationItem;
  status: Extract<FormationItemStatus, 'in_progress' | 'done'>;
}

/** The three targets upstream always requires a `reason` for (`blocked_reason_required`/`skip_reason_required`/`return_reason_required`, GH-2576 Phase 2). */
export type ReasonedFormationStatus = Extract<FormationItemStatus, 'blocked' | 'skipped' | 'not_started'>;

/** `FormationChecklistRowComponent`'s `reasonedStatusRequested` output payload — the counterpart to {@link FormationRowStatusChange} for the three targets that always need a reason. */
export interface FormationRowReasonedStatusChange {
  item: FormationItem;
  status: ReasonedFormationStatus;
}
