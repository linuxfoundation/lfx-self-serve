// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { LINKEDIN_STAFF_COUNT_RANGES, LINKEDIN_TARGETING_FACETS, LINKEDIN_TARGETING_FIELD, LINKEDIN_TARGETING_LIMITS } from '../constants/campaign.constants';
import type { LinkedInConfigKeyRefusal } from '../interfaces/campaign.interface';
import { foldKey } from './campaign-linkedin-config.utils';

/**
 * LinkedIn custom targeting (#5764 rows 8–11), mirroring campaign-service's checks (`checkTargetingShape` and
 * `linkedinTargeting` in `internal/dispatch/linkedin.go`, `ValidateTargeting` in
 * `internal/platform/linkedin/targeting_criteria.go`, #552), so a create campaign-service would refuse is refused here
 * first, with a field to point at.
 */

type Facets = Record<string, string[]>;

const TARGETING_KEYS = ['include', 'exclude'] as const;
const SHAPE_MESSAGE = 'Targeting must be an object with an include list of facet clauses and, optionally, an exclude object of facets.';
const SEGMENT_FACETS: readonly string[] = ['audienceMatchingSegments', 'dynamicSegments'];
const EMPLOYER_EXCLUSION_PATTERN = /^urn:li:(company|organization):[0-9]+$/;

function plainRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** `value` as facets (an object of string lists), or `null` when it is anything else. */
function asFacets(value: unknown): Facets | null {
  const record = plainRecord(value);
  if (!record) return null;
  for (const list of Object.values(record)) {
    if (!Array.isArray(list) || list.some((item) => typeof item !== 'string')) return null;
  }
  return record as Facets;
}

/** The id an employer URN names: `urn:li:company:<n>` and `urn:li:organization:<n>` are one employer. */
function employerKey(urn: string): string {
  return urn.slice(urn.lastIndexOf(':') + 1);
}

/** The include/exclude overlap namespace: both segment facets take `urn:li:adSegment:<id>`, so they count as one. */
function overlapKey(facet: string): string {
  return SEGMENT_FACETS.includes(facet) ? 'adSegment' : facet;
}

function facetLabel(facet: string, where: string): string {
  return `${where === 'exclude' ? 'Excluded' : 'Included'} ${facet}`;
}

/**
 * Why one facet list cannot be sent, or `null`, campaign-service's `cleanFacet`. `distinct` collects its distinct values
 * (employers by id, keeping the first URN), so the cap counts audiences, not spellings.
 */
function facetRefusal(facet: string, values: string[], where: string, distinct: string[]): LinkedInConfigKeyRefusal | null {
  const path = `${LINKEDIN_TARGETING_FIELD}.${where}`;
  const rule = Object.hasOwn(LINKEDIN_TARGETING_FACETS, facet) ? LINKEDIN_TARGETING_FACETS[facet] : undefined;
  if (!rule) {
    const accepted = Object.keys(LINKEDIN_TARGETING_FACETS).filter((key) => where !== 'exclude' || !LINKEDIN_TARGETING_FACETS[key].includeOnly);
    return { field: path, message: `Targeting names a facet LinkedIn does not take here. Use one of ${accepted.join(', ')}.` };
  }
  const field = `${path}.${facet}`;
  if (where === 'exclude' && rule.includeOnly) return { field, message: `LinkedIn takes ${facet} only as included targeting.` };
  if (values.length === 0) return { field, message: `${facetLabel(facet, where)} is empty. Add a value or remove the facet.` };
  const employers = facet === 'employers';
  const max = employers ? LINKEDIN_TARGETING_LIMITS.employerValues : LINKEDIN_TARGETING_LIMITS.facetValues;
  const seen = new Set<string>();
  for (const value of values) {
    if (value.trim() === '') return { field, message: `${facetLabel(facet, where)} holds a blank value.` };
    if (value !== value.trim()) return { field, message: `${facetLabel(facet, where)} holds a value with spaces around it.` };
    const valid = rule.pattern ? rule.pattern.test(value) : (LINKEDIN_STAFF_COUNT_RANGES as readonly string[]).includes(value);
    if (!valid) return { field, message: `${facetLabel(facet, where)} holds a value that is not a LinkedIn ${facet} value.` };
    const key = employers ? employerKey(value) : value;
    if (seen.has(key)) continue;
    seen.add(key);
    distinct.push(value);
    if (distinct.length > max) return { field, message: `${facetLabel(facet, where)} can hold at most ${max} values.` };
  }
  return null;
}

/**
 * The deployment's `employerExclusions` as campaign-service reads them with targeting set (`targetingEmployerExclusions`):
 * trimmed, blanks dropped, held to the `employers` rule and de-duplicated by id. `null` when one is malformed.
 */
function configuredExclusions(employerExclusions: readonly string[]): string[] | null {
  const trimmed = employerExclusions.map((value) => value.trim()).filter((value) => value !== '');
  if (trimmed.some((value) => !EMPLOYER_EXCLUSION_PATTERN.test(value))) return null;
  if (trimmed.length === 0) return [];
  const distinct: string[] = [];
  return facetRefusal('employers', trimmed, 'exclude', distinct) === null ? distinct : null;
}

/**
 * Why `raw`'s `targeting` cannot be sent, or `null` (#5764 rows 8–11). Typed runtime checks, since the create route has
 * no body validator. Absent `targeting` is the profile create and needs nothing here. Refused:
 *
 * - a `targeting` that is not an object of an `include` list of facet objects and an optional `exclude` facet object,
 *   each facet a list of text, or that carries another key (a misspelled `exclude` would silently widen the audience);
 * - any `targeting` while this deployment cannot send it (`enabled`): refused, never dropped, since the legacy creator
 *   would target the profile instead and campaign-service refuses it while its own flag is off;
 * - `targeting` with `targetingProfileEdit`: campaign-service does not read the profile once `targeting` is set;
 * - no include clause or more than `LINKEDIN_TARGETING_LIMITS.clauses`, an empty clause or facet, an unknown facet,
 *   `groups` or `interfaceLocales` excluded, a blank, padded or malformed value, or more distinct values than LinkedIn
 *   takes (employers compared by id);
 * - included titles with included seniorities or jobFunctions, included employers with included industries or
 *   staffCountRanges (wherever they sit, as campaign-service refuses them), and staffCountRanges both included and
 *   excluded;
 * - a value both included and excluded (the two segment facets count as one, employers compared by id);
 * - an included employer in the deployment's `employerExclusions`, or more employers than LinkedIn takes once those are
 *   merged into `exclude.employers`; a malformed configured exclusion refuses every targeted create.
 *
 * Facets are walked in sorted key order, as campaign-service walks them. Messages never echo a caller value.
 */
export function linkedInTargetingRefusal(raw: unknown, enabled: boolean, employerExclusions: readonly string[]): LinkedInConfigKeyRefusal | null {
  const config = plainRecord(raw);
  if (!config || !('targeting' in config)) return null;
  const targeting = plainRecord(config['targeting']);
  if (!targeting) return { field: LINKEDIN_TARGETING_FIELD, message: SHAPE_MESSAGE };
  for (const key of Object.keys(targeting)) {
    if ((TARGETING_KEYS as readonly string[]).includes(key)) continue;
    const match = TARGETING_KEYS.find((known) => foldKey(known) === foldKey(key));
    if (match) return { field: `${LINKEDIN_TARGETING_FIELD}.${match}`, message: `Send it as ${LINKEDIN_TARGETING_FIELD}.${match}, spelled exactly.` };
    return { field: LINKEDIN_TARGETING_FIELD, message: SHAPE_MESSAGE };
  }
  const includeRaw = targeting['include'];
  const include = Array.isArray(includeRaw) ? includeRaw.map(asFacets) : null;
  if (!include || include.some((clause) => clause === null)) return { field: `${LINKEDIN_TARGETING_FIELD}.include`, message: SHAPE_MESSAGE };
  // An explicit `null` is no exclusions, as campaign-service decodes it.
  const exclude = targeting['exclude'] === undefined || targeting['exclude'] === null ? {} : asFacets(targeting['exclude']);
  if (!exclude) return { field: `${LINKEDIN_TARGETING_FIELD}.exclude`, message: SHAPE_MESSAGE };

  if (!enabled) {
    return { field: LINKEDIN_TARGETING_FIELD, message: 'This deployment cannot send custom LinkedIn targeting. Remove it to target the selected profile.' };
  }
  if ('targetingProfileEdit' in config) {
    return {
      field: LINKEDIN_TARGETING_FIELD,
      message: 'Custom targeting replaces the targeting profile, so it cannot go with a profile edit. Send one of them.',
    };
  }
  if (include.length === 0) return { field: `${LINKEDIN_TARGETING_FIELD}.include`, message: 'Add at least one included targeting clause.' };
  if (include.length > LINKEDIN_TARGETING_LIMITS.clauses) {
    return { field: `${LINKEDIN_TARGETING_FIELD}.include`, message: `Targeting can hold at most ${LINKEDIN_TARGETING_LIMITS.clauses} included clauses.` };
  }

  const included = new Map<string, string[]>();
  for (const [index, clause] of (include as Facets[]).entries()) {
    const where = `include[${index}]`;
    const keys = Object.keys(clause).sort();
    if (keys.length === 0)
      return { field: `${LINKEDIN_TARGETING_FIELD}.${where}`, message: `Included clause ${index + 1} is empty. Add a facet or remove the clause.` };
    for (const facet of keys) {
      const distinct: string[] = [];
      const refusal = facetRefusal(facet, clause[facet], where, distinct);
      if (refusal !== null) return refusal;
      included.set(overlapKey(facet), [...(included.get(overlapKey(facet)) ?? []), ...distinct]);
    }
  }
  const excluded = new Map<string, string[]>();
  for (const facet of Object.keys(exclude).sort()) {
    const distinct: string[] = [];
    const refusal = facetRefusal(facet, exclude[facet], 'exclude', distinct);
    if (refusal !== null) return refusal;
    excluded.set(facet, distinct);
  }

  const has = (facet: string): boolean => (included.get(facet)?.length ?? 0) > 0;
  if (has('titles') && (has('seniorities') || has('jobFunctions'))) {
    return {
      field: `${LINKEDIN_TARGETING_FIELD}.include`,
      message: 'LinkedIn does not take included titles together with included seniorities or job functions.',
    };
  }
  if (has('employers') && (has('industries') || has('staffCountRanges'))) {
    return {
      field: `${LINKEDIN_TARGETING_FIELD}.include`,
      message: 'LinkedIn does not take included employers together with included industries or company sizes.',
    };
  }
  if (has('staffCountRanges') && (excluded.get('staffCountRanges')?.length ?? 0) > 0) {
    return { field: `${LINKEDIN_TARGETING_FIELD}.exclude.staffCountRanges`, message: 'Company sizes can be included or excluded, not both.' };
  }
  for (const [facet, values] of excluded) {
    const inside = included.get(overlapKey(facet)) ?? [];
    const key = facet === 'employers' ? employerKey : (value: string) => value;
    const insideKeys = new Set(inside.map(key));
    if (values.some((value) => insideKeys.has(key(value)))) {
      return { field: `${LINKEDIN_TARGETING_FIELD}.exclude.${facet}`, message: `Excluded ${facet} holds a value that is also included.` };
    }
  }

  const configured = configuredExclusions(employerExclusions);
  if (configured === null) {
    return { field: LINKEDIN_TARGETING_FIELD, message: "This deployment's LinkedIn employer exclusions are not valid, so custom targeting cannot be sent." };
  }
  const includedEmployers = new Set((included.get('employers') ?? []).map(employerKey));
  if (configured.some((value) => includedEmployers.has(employerKey(value)))) {
    return { field: `${LINKEDIN_TARGETING_FIELD}.include`, message: 'An included employer is on the employers this deployment always excludes. Remove it.' };
  }
  const merged = new Set([...(excluded.get('employers') ?? []), ...configured].map(employerKey));
  if (merged.size > LINKEDIN_TARGETING_LIMITS.employerValues) {
    return {
      field: `${LINKEDIN_TARGETING_FIELD}.exclude.employers`,
      message: `Excluded employers, with the ones this deployment always excludes, can hold at most ${LINKEDIN_TARGETING_LIMITS.employerValues}.`,
    };
  }
  return null;
}

/**
 * Whether `raw`'s `targeting` names an ad segment (`audienceMatchingSegments` or `dynamicSegments`, included or
 * excluded). Segments are audiences on the ad account every foundation shares, so a create naming one needs
 * `global_marketing_ops` on the project, as campaign-service requires. Run after `linkedInTargetingRefusal` passed.
 */
export function linkedInTargetingNamesSegments(raw: unknown): boolean {
  const targeting = plainRecord(plainRecord(raw)?.['targeting']);
  if (!targeting) return false;
  const include = Array.isArray(targeting['include']) ? (targeting['include'] as unknown[]) : [];
  const groups = [...include, targeting['exclude']].map(plainRecord);
  return groups.some((facets) => facets !== null && SEGMENT_FACETS.some((facet) => Object.hasOwn(facets, facet)));
}
