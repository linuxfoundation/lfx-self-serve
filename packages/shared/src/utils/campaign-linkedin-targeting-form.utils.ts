// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  LINKEDIN_AUDIENCES_ACCESS_UNAVAILABLE_CODE,
  LINKEDIN_AUDIENCES_ACCESS_UNAVAILABLE_MESSAGE,
  LINKEDIN_AUDIENCES_FAILED_MESSAGE,
  LINKEDIN_AUDIENCES_LOADING_MESSAGE,
  LINKEDIN_AUDIENCES_RESTRICTED_MESSAGE,
  LINKEDIN_TARGETING_EDITOR_FACETS,
  LINKEDIN_TARGETING_FACETS,
  LINKEDIN_TARGETING_LIMITS,
  LINKEDIN_TARGETING_SEARCH_BUSY_MESSAGE,
  LINKEDIN_TARGETING_SEARCH_FAILED_MESSAGE,
  LINKEDIN_TARGETING_SEGMENTS_ACCOUNT_MESSAGE,
  LINKEDIN_TARGETING_STATIC_VALUES,
} from '../constants/campaign.constants';
import type {
  LinkedInAudienceSegment,
  LinkedInAudiencesState,
  LinkedInTargeting,
  LinkedInTargetingDraft,
  LinkedInTargetingEditorFacet,
  LinkedInTargetingEditorFacetOption,
  LinkedInTargetingEntity,
  LinkedInTargetingFacetPicks,
  LinkedInTargetingPlacement,
  LinkedInTargetingSegmentChoice,
  LinkedInTargetingSegmentFacet,
} from '../interfaces/campaign.interface';
import { linkedInTargetingRefusal } from './campaign-linkedin-targeting.utils';

/**
 * The Implement tab's LinkedIn custom targeting editor (#5764 rows 8–11): what a pick adds or removes, which facets a
 * clause or the exclusions may still add, the `linkedInConfig.targeting` a create sends, and why Create waits. The
 * component holds the draft and runs the search; these hold the rules.
 */

const NO_CLAUSE_MESSAGE = 'Add at least one included targeting clause.';

/** A draft with one empty clause to start from, no exclusions and no segments. */
export function emptyLinkedInTargetingDraft(): LinkedInTargetingDraft {
  return { clauses: [{}], exclude: {}, segmentsAccountId: null };
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

/**
 * Every value picked across `groups`, per facet. The exclusions are offered without what a clause already includes, so
 * the editor never builds a value both included and excluded, which the create refuses.
 */
export function linkedInTargetingMergedPicks(...groups: LinkedInTargetingFacetPicks[]): LinkedInTargetingFacetPicks {
  const merged: LinkedInTargetingFacetPicks = {};
  for (const { key } of LINKEDIN_TARGETING_EDITOR_FACETS) {
    const picks = groups.flatMap((group) => group[key] ?? []);
    if (picks.length > 0) merged[key] = picks;
  }
  return merged;
}

/**
 * A value's identity as the create compares it: an employer by its id, since `urn:li:company:<n>` and
 * `urn:li:organization:<n>` are one employer to `linkedInTargetingRefusal`; any other value by its URN.
 */
function pickIdentity(urn: string): string {
  const employer = /^urn:li:(?:company|organization):(\d+)$/.exec(urn);
  return employer ? `employer:${employer[1]}` : urn;
}

/** Search results not yet picked under the facet (employers compared by id). */
export function linkedInTargetingSearchChoices(
  entities: readonly LinkedInTargetingEntity[],
  picked: readonly LinkedInTargetingEntity[] = []
): LinkedInTargetingEntity[] {
  const taken = new Set(picked.map((pick) => pickIdentity(pick.urn)));
  return entities.filter((entity) => !taken.has(pickIdentity(entity.urn)));
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

/**
 * The segment read's state after it failed with `status` and the error body's `code`: `restricted` on a 403 (only
 * `global_marketing_ops` on the project may read or send segments), else `unavailable`, saying to try again.
 */
export function linkedInAudiencesFailure(status: number, code: unknown): LinkedInAudiencesState {
  if (status === 403) return { status: 'restricted', audiences: [], failure: LINKEDIN_AUDIENCES_RESTRICTED_MESSAGE };
  const failure =
    status === 503 && code === LINKEDIN_AUDIENCES_ACCESS_UNAVAILABLE_CODE ? LINKEDIN_AUDIENCES_ACCESS_UNAVAILABLE_MESSAGE : LINKEDIN_AUDIENCES_FAILED_MESSAGE;
  return { status: 'unavailable', audiences: [], failure };
}

/** What a segment's status adds to its label: nothing once `READY`, else that it will not serve. */
function segmentStatusNote(status: string): string {
  if (status === 'READY') return '';
  if (status === 'ARCHIVED') return " (archived — won't serve)";
  return ` (${status.toLowerCase()} — won't serve until ready)`;
}

/** A segment as the select lists it: its name, its approximate size when LinkedIn gives one, and a status note. */
export function linkedInAudienceSegmentLabel(segment: LinkedInAudienceSegment): string {
  const size = segment.approximateMemberCount === null ? '' : ` · ~${segment.approximateMemberCount.toLocaleString('en-US')} members`;
  return `${segment.name}${size}${segmentStatusNote(segment.status)}`;
}

/**
 * The segments `facet` may still add: the account's segments of that facet whose URN is in neither segment facet of
 * `taken` (this group's picks and what it must not offer). The two segment facets are one namespace for the
 * include/exclude overlap, as `linkedInTargetingRefusal` compares them.
 */
export function linkedInTargetingSegmentChoices(
  facet: LinkedInTargetingSegmentFacet,
  audiences: readonly LinkedInAudienceSegment[],
  taken: LinkedInTargetingFacetPicks
): LinkedInTargetingSegmentChoice[] {
  const picked = new Set([...(taken.audienceMatchingSegments ?? []), ...(taken.dynamicSegments ?? [])].map((pick) => pick.urn));
  return audiences
    .filter((segment) => segment.facet === facet && !picked.has(segment.urn))
    .map((segment) => ({ urn: segment.urn, name: segment.name, label: linkedInAudienceSegmentLabel(segment) }));
}

/**
 * What the segment area says in place of, or under, its select, or `null` when there are choices: loading, the read's
 * failure, that the account has no segments of this facet, or that every one is already used in this targeting.
 */
export function linkedInTargetingSegmentMessage(state: LinkedInAudiencesState, facet: LinkedInTargetingSegmentFacet, choiceCount: number): string | null {
  if (state.status === 'loading') return LINKEDIN_AUDIENCES_LOADING_MESSAGE;
  if (state.status !== 'loaded') return state.failure;
  if (choiceCount > 0) return null;
  if (!state.audiences.some((segment) => segment.facet === facet)) {
    return `No ${facet === 'dynamicSegments' ? 'retargeting' : 'matched'} audiences on this ad account.`;
  }
  return 'Every one of these audiences is already used in this targeting.';
}

/** `picks` without the segment facets, or `picks` itself when it holds none. */
function picksWithoutSegments(picks: LinkedInTargetingFacetPicks): LinkedInTargetingFacetPicks {
  if (!picks.audienceMatchingSegments && !picks.dynamicSegments) return picks;
  const { audienceMatchingSegments: _matched, dynamicSegments: _dynamic, ...rest } = picks;
  return rest;
}

/**
 * `draft` without any ad segment, in every clause and in the exclusions, and so with no segment account; nothing else is
 * dropped. Segments belong to the ad account they were read from, so the editor drops them when the create's account
 * changes. `draft` itself when it holds none, so nothing is emitted for a draft without segments.
 */
export function linkedInTargetingDraftWithoutSegments(draft: LinkedInTargetingDraft): LinkedInTargetingDraft {
  const clauses = draft.clauses.map(picksWithoutSegments);
  const exclude = picksWithoutSegments(draft.exclude);
  if (exclude === draft.exclude && clauses.every((clause, i) => clause === draft.clauses[i])) return draft;
  return { clauses, exclude, segmentsAccountId: null };
}

/** Whether `draft` holds an ad segment anywhere. */
function draftHasSegments(draft: LinkedInTargetingDraft): boolean {
  return [...draft.clauses, draft.exclude].some((picks) => (picks.audienceMatchingSegments?.length ?? 0) + (picks.dynamicSegments?.length ?? 0) > 0);
}

/**
 * Who segment picks are made for: the foundation and the ad account the create uses (`null`: that foundation's
 * default, which differs per foundation, so the foundation is part of the key). Compared, never parsed.
 */
export function linkedInSegmentsOwnerKey(projectSlug: string, accountId: string | null): string {
  return `${projectSlug}|${accountId ?? ''}`;
}

/**
 * `next`, an edit of `previous`, with the ad account its segments were picked for: none once no segment is left; the
 * editor's account (`accountId`) for the first segment picked; else `previous`'s, so a segment added beside ones picked
 * for another account does not make those sendable.
 */
export function linkedInTargetingDraftWithSegmentsAccount(
  previous: LinkedInTargetingDraft,
  next: LinkedInTargetingDraft,
  accountId: string | null
): LinkedInTargetingDraft {
  if (!draftHasSegments(next)) return { ...next, segmentsAccountId: null };
  return { ...next, segmentsAccountId: draftHasSegments(previous) ? previous.segmentsAccountId : accountId };
}

/**
 * Why `draft` cannot go to the ad account `accountId` (`null`: the default), or `null`: it holds segments picked for
 * another account. Held, never dropped, so the operator sees what changed.
 */
export function linkedInTargetingSegmentsAccountRefusal(draft: LinkedInTargetingDraft, accountId: string | null): string | null {
  return draftHasSegments(draft) && draft.segmentsAccountId !== accountId ? LINKEDIN_TARGETING_SEGMENTS_ACCOUNT_MESSAGE : null;
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
  const segmentsAccountId = typeof record['segmentsAccountId'] === 'string' ? record['segmentsAccountId'] : null;
  return { clauses: clauses.length > 0 ? clauses : [{}], exclude: storedPicks(record['exclude']), segmentsAccountId };
}
