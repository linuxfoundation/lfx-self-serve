// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Committee, CommitteeFoundationGroup, CommitteeMemberPermissionInfo, GroupBehavioralClass } from '../interfaces/committee.interface';
import { CommitteeMember } from '../interfaces/member.interface';
import { CATEGORY_BEHAVIORAL_CLASS, FOUNDATION_LEVEL_GROUP_FALLBACK_LABEL, OTHER_GROUPS_LABEL } from '../constants/committees.constants';
import { slugify } from './string.utils';

/**
 * Determine the behavioral class for a given committee category.
 * Falls back to partial string matching if exact match not found.
 */
export function getGroupBehavioralClass(category: string | undefined): GroupBehavioralClass {
  if (!category) return 'other';

  // Exact match first
  if (CATEGORY_BEHAVIORAL_CLASS[category]) {
    return CATEGORY_BEHAVIORAL_CLASS[category];
  }

  // Partial match fallback (handles custom/variant PCC categories)
  const lower = category.toLowerCase();

  // Governing board
  if (lower.includes('board') || lower.includes('government')) {
    return 'governing-board';
  }

  // Oversight committee
  if (
    lower === 'tsc' ||
    lower === 'toc' ||
    lower === 'tac' ||
    lower.includes('technical steering') ||
    lower.includes('technical advisory') ||
    lower.includes('technical oversight') ||
    lower.includes('legal') ||
    lower.includes('finance') ||
    lower.includes('code of conduct') ||
    lower.includes('product security')
  ) {
    return 'oversight-committee';
  }

  // Working group
  if (lower.includes('working group') || lower.includes('expert') || lower.includes('maintainer') || lower.includes('committer')) {
    return 'working-group';
  }

  // Special interest group (includes marketing outreach)
  if (lower.includes('special interest') || /\bsig\b/.test(lower) || lower.includes('technical mailing') || lower.includes('marketing')) {
    return 'special-interest-group';
  }

  // Ambassador program
  if (lower.includes('ambassador')) {
    return 'ambassador-program';
  }

  return 'other';
}

/**
 * Build the query params used when navigating to create a vote or survey for a committee.
 * Always includes `committee_uid`; includes `project` only when the committee carries a project slug.
 */
export function buildCommitteeCreateQueryParams(committee: Committee): Record<string, string> {
  const params: Record<string, string> = { committee_uid: committee.uid };
  if (committee.project_slug) {
    params['project'] = committee.project_slug;
  }
  return params;
}

// ── Per-type query helpers ──────────────────────────────────────────────────

/** True for governing-board type */
export function isGoverningBoard(category: string | undefined): boolean {
  return getGroupBehavioralClass(category) === 'governing-board';
}

/** True for oversight-committee type */
export function isOversightCommittee(category: string | undefined): boolean {
  return getGroupBehavioralClass(category) === 'oversight-committee';
}

/** True for working-group type */
export function isWorkingGroup(category: string | undefined): boolean {
  return getGroupBehavioralClass(category) === 'working-group';
}

/** True for special-interest-group type */
export function isSpecialInterestGroup(category: string | undefined): boolean {
  return getGroupBehavioralClass(category) === 'special-interest-group';
}

/** True for ambassador-program type */
export function isAmbassadorProgram(category: string | undefined): boolean {
  return getGroupBehavioralClass(category) === 'ambassador-program';
}

/** True for other (catch-all) type */
export function isOtherClass(category: string | undefined): boolean {
  return getGroupBehavioralClass(category) === 'other';
}

// ── Backward-compatible aggregate helpers ───────────────────────────────────

/**
 * Check if a category shows governance-style dashboard cards (votes, budgets, resolutions).
 * True for: governing-board and oversight-committee.
 */
export function isGovernanceClass(category: string | undefined): boolean {
  const cls = getGroupBehavioralClass(category);
  return cls === 'governing-board' || cls === 'oversight-committee';
}

/**
 * Check if a category shows collaboration-style dashboard cards (activity, contributors).
 * True for: working-group, special-interest-group, oversight-committee, ambassador-program, and other.
 */
export function isCollaborationClass(category: string | undefined): boolean {
  const cls = getGroupBehavioralClass(category);
  return cls === 'working-group' || cls === 'special-interest-group' || cls === 'oversight-committee' || cls === 'ambassador-program' || cls === 'other';
}

// ── Member permission resolution (LFXV2-2059) ───────────────────────────────

/**
 * Match a member to a writer/auditor entry. Prefers the Auth0 username (the stable identity the
 * permission lists key on, e.g. `auth0|jdoe`) and falls back to a case-insensitive email match for
 * members or entries without a resolved username.
 */
export function matchesCommitteeUser(member: Pick<CommitteeMember, 'username' | 'email'>, candidate: { username?: string; email?: string }): boolean {
  const memberEmail = member.email?.toLowerCase();
  return (!!member.username && candidate.username === member.username) || (!!memberEmail && candidate.email?.toLowerCase() === memberEmail);
}

/**
 * Resolve a member's roster permission for the given committee.
 *
 * Committee-scoped grants (`writers` / `auditors`) take precedence; when the member holds no
 * committee-scoped role, falls back to grants inherited from the project/foundation ancestry
 * (`inherited_writers` / `inherited_auditors`) so a foundation-level "Manage" user is shown as
 * Manage rather than a plain member (LFXV2-2059). Manage outranks Reviewer at every level.
 *
 * `inherited` is true only when the member has no direct committee role but matches an inherited
 * grant — it drives the "(inherited)" label suffix.
 */
export function resolveCommitteeMemberPermission(committee: Committee | null | undefined, member: CommitteeMember): CommitteeMemberPermissionInfo {
  if (!committee) return { level: 'member', inherited: false };

  const matches = (candidate: { username?: string; email?: string }): boolean => matchesCommitteeUser(member, candidate);
  const hasDirectRole = !!committee.writers?.some(matches) || !!committee.auditors?.some(matches);

  if (committee.writers?.some(matches) || committee.inherited_writers?.some(matches)) {
    return { level: 'manage', inherited: !hasDirectRole };
  }
  if (committee.auditors?.some(matches) || committee.inherited_auditors?.some(matches)) {
    return { level: 'review', inherited: !hasDirectRole };
  }
  return { level: 'member', inherited: false };
}

/**
 * Whether the current caller can manage this committee's members. Driven by the effective `writer`
 * flag, which the authorization model already derives from inherited project/foundation grants
 * (`committee#writer` ← `writer from project`), so a foundation-level manager resolves to true
 * without a separate inherited check (LFXV2-2059).
 */
export function canManageCommitteeMembers(committee: Committee | null | undefined): boolean {
  return !!committee?.writer;
}

// ── All Groups foundation-grouping (LFXV2-1715) ─────────────────────────────

/**
 * Groups an already-filtered All Groups list by resolved label, keyed by `project_uid` when a real
 * `project_name` resolved — so two genuinely distinct sub-projects that happen to share a display
 * name still render as two buckets (disambiguated by testid slug), never silently merged — but keyed
 * by the resolved label text itself when `project_name` is missing, whether that label falls back to
 * `foundation_name` or all the way to the fallback constants. A degraded committee merges into an
 * existing named bucket only when the label unambiguously belongs to exactly one named project (e.g.
 * a project literally named "CNCF" and a committee that degrades to `foundation_name: 'CNCF'`); if
 * two distinct named projects share that label, which one the committee "really" belongs to can't be
 * determined, so it falls back to its own label-keyed bucket instead of merging into an arbitrary one.
 *
 * Pure and side-effect-free: callers gate whether grouping applies at all (e.g. only in foundation
 * scope) and decide the input list (e.g. already search/filter-narrowed).
 */
export function groupCommitteesByFoundation(committees: Committee[]): CommitteeFoundationGroup[] {
  const buckets = new Map<string, CommitteeFoundationGroup>();
  const namedKeysByLabel = new Map<string, Set<string>>();

  const addTo = (key: string, label: string, committee: Committee): void => {
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { key, label, testIdSlug: '', isFoundationLevel: false, committees: [] };
      buckets.set(key, bucket);
    }
    bucket.isFoundationLevel = bucket.isFoundationLevel || !!committee.is_foundation;
    bucket.committees.push(committee);
  };

  // First pass: named projects get their own project_uid-keyed bucket. Track every distinct named
  // key seen under each label, so a degraded committee (second pass) only merges into a named bucket
  // when the label unambiguously identifies exactly one of them.
  for (const committee of committees) {
    if (!committee.project_name) continue;
    addTo(committee.project_uid, committee.project_name, committee);
    const keys = namedKeysByLabel.get(committee.project_name) ?? new Set<string>();
    keys.add(committee.project_uid);
    namedKeysByLabel.set(committee.project_name, keys);
  }

  // Second pass: degraded committees (no project_name) resolve to foundation_name or a fallback
  // constant, merging into the unique named bucket sharing that label when there is exactly one;
  // otherwise every committee that degrades to the same text shares one label-keyed bucket.
  for (const committee of committees) {
    if (committee.project_name) continue;
    const label = committee.foundation_name || (committee.is_foundation ? FOUNDATION_LEVEL_GROUP_FALLBACK_LABEL : OTHER_GROUPS_LABEL);
    const namedKeys = namedKeysByLabel.get(label);
    const key = namedKeys?.size === 1 ? [...namedKeys][0] : label;
    addTo(key, label, committee);
  }

  const groups = [...buckets.values()].sort((a, b) => {
    if (a.isFoundationLevel !== b.isFoundationLevel) return a.isFoundationLevel ? -1 : 1;
    // Equal labels happen between distinct named buckets sharing a display name (the deliberate
    // non-merge case), and between those and the label-keyed bucket an ambiguous degraded lookup
    // produces. Break the tie by key — a plain code-point comparison, not localeCompare, since keys
    // are opaque identifiers (a project_uid or raw label text) rather than human-readable text, and
    // this runs on both sides of SSR: any server/client ICU collation difference in a locale-aware
    // compare would flip the testid slug suffix assigned below between the SSR HTML and the
    // hydrated DOM — the exact instability this tiebreak exists to close.
    if (a.label === b.label) return compareCodePoints(a.key, b.key);
    if (a.label === OTHER_GROUPS_LABEL) return 1;
    if (b.label === OTHER_GROUPS_LABEL) return -1;
    return a.label.localeCompare(b.label);
  });

  // Disambiguate testid slugs only when two groups genuinely share a slug (rare) — keeps the common
  // case's testid a clean, human-readable slug instead of always suffixing a raw uid. Falls back to
  // 'group' for a label with no ASCII alphanumerics (e.g. a non-Latin project/foundation name), so
  // the testid is never a bare, colliding "groups-foundation-group-".
  const slugCounts = new Map<string, number>();
  return groups.map((group) => {
    const baseSlug = slugify(group.label) || 'group';
    const occurrence = (slugCounts.get(baseSlug) ?? 0) + 1;
    slugCounts.set(baseSlug, occurrence);
    return { ...group, testIdSlug: occurrence === 1 ? baseSlug : `${baseSlug}-${occurrence}` };
  });
}

/** Deterministic, locale-independent ordering for opaque identifier strings (not human-readable text — use `localeCompare` for that). */
function compareCodePoints(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
