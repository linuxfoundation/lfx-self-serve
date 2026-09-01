// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { FormationActivity, FormationItem, FormationItemStatus, FormationSubStage, FormationTemplateSection } from './formation.interface';

/**
 * Client-derived stand-in for the readiness strip. TODO(#1957): once the backend returns a
 * pre-computed `readiness_summary` on `FormationChecklistResponse`, delete
 * `deriveFormationReadinessSummary`'s call site and consume that field directly — every consumer
 * is already typed against this interface, so the swap only touches `formation-checklist.utils.ts`
 * and its one call site, never the components that read `FormationReadinessSummary`.
 */
export interface FormationReadinessSummary {
  /** One entry per checklist item, in template order — the literal per-item segment bar (not a 2-color fill/total bar). */
  segments: FormationItemStatus[];
  totalItems: number;
  counts: Record<FormationItemStatus, number>;
  /** True once every gating item is `done` (mirrors `Formation.is_activating`). */
  isActivating: boolean;
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
