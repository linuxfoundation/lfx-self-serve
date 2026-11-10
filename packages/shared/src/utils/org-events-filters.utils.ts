// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  DEFAULT_ORG_EVENTS_ATTRIBUTION,
  DEFAULT_ORG_EVENTS_PARTICIPATION,
  DEFAULT_ORG_EVENTS_SCOPE,
  ORG_EVENTS_ATTRIBUTION_OPTIONS,
  ORG_EVENTS_PARTICIPATION_OPTIONS,
  ORG_EVENTS_SCOPE_OPTIONS,
} from '../constants/org-events-filters.constants';
import type { OrgEventsAttribution, OrgEventsParticipation, OrgEventsScope } from '../interfaces/org-events-filters.interface';

/** `attribution` value → "Counted by" option, or `null` when it is not one of the allowed values. */
export function parseOrgEventsAttribution(value: string | null | undefined): OrgEventsAttribution | null {
  return ORG_EVENTS_ATTRIBUTION_OPTIONS.find((option) => option.value === value)?.value ?? null;
}

/** `participation` value → "Count" option, or `null` when it is not one of the allowed values. */
export function parseOrgEventsParticipation(value: string | null | undefined): OrgEventsParticipation | null {
  return ORG_EVENTS_PARTICIPATION_OPTIONS.find((option) => option.value === value)?.value ?? null;
}

/** `eventScope` value → "Show" option, or `null` when it is not one of the allowed values. */
export function parseOrgEventsScope(value: string | null | undefined): OrgEventsScope | null {
  return ORG_EVENTS_SCOPE_OPTIONS.find((option) => option.value === value)?.value ?? null;
}

/** "Counted by" → `?attribution=` URL value, `null` (dropped) at the default. */
export function orgEventsAttributionUrlParam(attribution: OrgEventsAttribution): OrgEventsAttribution | null {
  return attribution === DEFAULT_ORG_EVENTS_ATTRIBUTION ? null : attribution;
}

/** "Count" → `?participation=` URL value, `null` (dropped) at the default. */
export function orgEventsParticipationUrlParam(participation: OrgEventsParticipation): OrgEventsParticipation | null {
  return participation === DEFAULT_ORG_EVENTS_PARTICIPATION ? null : participation;
}

/** "Show" → `?eventScope=` URL value, `null` (dropped) at the default. */
export function orgEventsScopeUrlParam(scope: OrgEventsScope): OrgEventsScope | null {
  return scope === DEFAULT_ORG_EVENTS_SCOPE ? null : scope;
}

/**
 * The participation a read serves for a pick: `attended` and `all` only on a tab of ended events — upcoming events have no
 * attendance, so the Upcoming tab always counts registrations (and `all`, registered or attended, is registered there).
 */
export function effectiveOrgEventsParticipation(participation: OrgEventsParticipation, isPastTab: boolean): OrgEventsParticipation {
  return participation !== 'registered' && !isPastTab ? 'registered' : participation;
}
