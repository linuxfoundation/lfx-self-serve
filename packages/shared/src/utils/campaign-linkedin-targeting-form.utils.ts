// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  LINKEDIN_TARGETING_EDITOR_FACETS,
  LINKEDIN_TARGETING_FACETS,
  LINKEDIN_TARGETING_LIMITS,
  LINKEDIN_TARGETING_SEARCH_BUSY_MESSAGE,
  LINKEDIN_TARGETING_SEARCH_FAILED_MESSAGE,
  LINKEDIN_TARGETING_STATIC_VALUES,
} from '../constants/campaign.constants';
import type {
  LinkedInTargeting,
  LinkedInTargetingDraft,
  LinkedInTargetingEditorFacet,
  LinkedInTargetingEditorFacetOption,
  LinkedInTargetingEntity,
  LinkedInTargetingFacetPicks,
  LinkedInTargetingPlacement,
} from '../interfaces/campaign.interface';
import { linkedInTargetingRefusal } from './campaign-linkedin-targeting.utils';

/**
 * The Implement tab's LinkedIn custom targeting editor (#5764 rows 8–11): what a pick adds or removes, which facets a
 * clause or the exclusions may still add, the `linkedInConfig.targeting` a create sends, and why Create waits. The
 * component holds the draft and runs the search; these hold the rules.
 */

const NO_CLAUSE_MESSAGE = 'Add at least one included targeting clause.';

/** A draft with one empty clause to start from and no exclusions. */
export function emptyLinkedInTargetingDraft(): LinkedInTargetingDraft {
  return { clauses: [{}], exclude: {} };
}

/** How many distinct values `facet` takes in one list: employers have their own, larger cap. */
export function linkedInTargetingFacetCap(facet: LinkedInTargetingEditorFacet): number {
  return facet === 'employers' ? LINKEDIN_TARGETING_LIMITS.employerValues : LINKEDIN_TARGETING_LIMITS.facetValues;
}

/**
 * The facets a clause (`include`) or the exclusions may add values to: the editor's facets, less the include-only ones
 * (`groups`) under `exclude`, and less any facet already at its cap.
 */
export function linkedInTargetingFacetsToAdd(placement: LinkedInTargetingPlacement, picks: LinkedInTargetingFacetPicks): LinkedInTargetingEditorFacetOption[] {
  return LINKEDIN_TARGETING_EDITOR_FACETS.filter(
    (facet) =>
      !(placement === 'exclude' && LINKEDIN_TARGETING_FACETS[facet.key].includeOnly) && (picks[facet.key]?.length ?? 0) < linkedInTargetingFacetCap(facet.key)
  );
}

/** `picks` with `entity` added under `facet`: unchanged when its URN is already there or the facet is at its cap. */
export function linkedInTargetingPicksWith(
  picks: LinkedInTargetingFacetPicks,
  facet: LinkedInTargetingEditorFacet,
  entity: LinkedInTargetingEntity
): LinkedInTargetingFacetPicks {
  const current = picks[facet] ?? [];
  if (current.some((pick) => pick.urn === entity.urn) || current.length >= linkedInTargetingFacetCap(facet)) return picks;
  return { ...picks, [facet]: [...current, { urn: entity.urn, name: entity.name }] };
}

/** `picks` without `urn` under `facet`; a facet left empty is dropped. */
export function linkedInTargetingPicksWithout(
  picks: LinkedInTargetingFacetPicks,
  facet: LinkedInTargetingEditorFacet,
  urn: string
): LinkedInTargetingFacetPicks {
  const rest = (picks[facet] ?? []).filter((pick) => pick.urn !== urn);
  const next = { ...picks };
  if (rest.length > 0) next[facet] = rest;
  else delete next[facet];
  return next;
}

/** A fixed-list facet's values not yet picked, or `[]` for a searched facet. */
export function linkedInTargetingStaticChoices(facet: LinkedInTargetingEditorFacet, picks: LinkedInTargetingFacetPicks): LinkedInTargetingEntity[] {
  const values: readonly LinkedInTargetingEntity[] = Object.hasOwn(LINKEDIN_TARGETING_STATIC_VALUES, facet)
    ? LINKEDIN_TARGETING_STATIC_VALUES[facet as keyof typeof LINKEDIN_TARGETING_STATIC_VALUES]
    : [];
  const picked = new Set((picks[facet] ?? []).map((pick) => pick.urn));
  return values.filter((value) => !picked.has(value.urn));
}

/** Search results not yet picked under the facet. */
export function linkedInTargetingSearchChoices(
  entities: readonly LinkedInTargetingEntity[],
  picked: readonly LinkedInTargetingEntity[] = []
): LinkedInTargetingEntity[] {
  const urns = new Set(picked.map((pick) => pick.urn));
  return entities.filter((entity) => !urns.has(entity.urn));
}

/** What a failed search says: LinkedIn busy (503), or failed otherwise. */
export function linkedInTargetingSearchFailure(status: number): string {
  return status === 503 ? LINKEDIN_TARGETING_SEARCH_BUSY_MESSAGE : LINKEDIN_TARGETING_SEARCH_FAILED_MESSAGE;
}

/**
 * What the typeahead's empty list says: why the typed text cannot be searched (`queryRefusal`), that a search is
 * running, why it failed, or that nothing matched.
 */
export function linkedInTargetingSearchEmptyMessage(queryRefusal: string | null, pending: boolean, failure: string | null): string {
  if (queryRefusal !== null) return queryRefusal;
  if (pending) return 'Searching…';
  return failure ?? 'Nothing matches. Try another word.';
}

/** Whether another include clause may be added. */
export function linkedInTargetingCanAddClause(draft: LinkedInTargetingDraft): boolean {
  return draft.clauses.length < LINKEDIN_TARGETING_LIMITS.clauses;
}

/** The picks as campaign-service facets (URN lists), empty facets dropped. */
function facetUrns(picks: LinkedInTargetingFacetPicks): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [facet, values] of Object.entries(picks)) {
    if (Array.isArray(values) && values.length > 0) out[facet] = values.map((value) => value.urn);
  }
  return out;
}

/**
 * The `linkedInConfig.targeting` a create sends for `draft`, or `null` when no clause holds a value. Empty facets and
 * clauses are dropped, and `exclude` is left out when it holds nothing.
 */
export function linkedInTargetingForCreate(draft: LinkedInTargetingDraft): LinkedInTargeting | null {
  const include = draft.clauses.map(facetUrns).filter((clause) => Object.keys(clause).length > 0);
  if (include.length === 0) return null;
  const exclude = facetUrns(draft.exclude);
  return Object.keys(exclude).length > 0 ? { include, exclude } : { include };
}

/**
 * Why `draft` cannot be sent, or `null`: the create route's own check (`linkedInTargetingRefusal`) on what
 * {@link linkedInTargetingForCreate} sends, so the tab holds Create on exactly what the BFF would refuse. The
 * deployment's employer exclusions are not known here; the BFF still checks them.
 */
export function linkedInTargetingDraftRefusal(draft: LinkedInTargetingDraft): string | null {
  const targeting = linkedInTargetingForCreate(draft);
  if (targeting === null) return NO_CLAUSE_MESSAGE;
  return linkedInTargetingRefusal({ targeting }, true, [])?.message ?? null;
}

function plainRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** Stored picks kept to the editor's facets and to entries whose URN and name are text. */
function storedPicks(raw: unknown): LinkedInTargetingFacetPicks {
  const record = plainRecord(raw);
  const out: LinkedInTargetingFacetPicks = {};
  for (const { key } of LINKEDIN_TARGETING_EDITOR_FACETS) {
    const values = record?.[key];
    if (!Array.isArray(values)) continue;
    const kept = values
      .map(plainRecord)
      .filter((value): value is Record<string, unknown> => typeof value?.['urn'] === 'string' && typeof value['name'] === 'string')
      .map((value) => ({ urn: value['urn'] as string, name: value['name'] as string }));
    if (kept.length > 0) out[key] = kept;
  }
  return out;
}

/**
 * A stored draft as the editor can show it, or `null` when `raw` is not one. A draft is replayed from stored JSON whose
 * inner shape is not validated, so unknown facets and malformed entries are dropped; a draft with no clause gets one.
 */
export function linkedInTargetingDraftFromStored(raw: unknown): LinkedInTargetingDraft | null {
  const record = plainRecord(raw);
  if (!record || !Array.isArray(record['clauses'])) return null;
  const clauses = (record['clauses'] as unknown[]).slice(0, LINKEDIN_TARGETING_LIMITS.clauses).map(storedPicks);
  return { clauses: clauses.length > 0 ? clauses : [{}], exclude: storedPicks(record['exclude']) };
}
