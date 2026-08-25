// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommitteeMemberRole, CommitteeMemberVotingStatus } from '../enums/committee-member.enum';
import type { Committee, CommitteeFoundationGroup, CommitteeMemberPermissionInfo, GroupBehavioralClass } from '../interfaces/committee.interface';
import type { GroupsEngagementStats } from '../interfaces/groups-engagement-stats.interface';
import type { CommitteeMember } from '../interfaces/member.interface';
import type { BadgeSeverity } from '../interfaces/components.interface';
import type { StatCardItem } from '../interfaces/stat-card.interface';
import {
  CATEGORY_BEHAVIORAL_CLASS,
  FOUNDATION_LEVEL_GROUP_FALLBACK_LABEL,
  GROUPS_ENGAGEMENT_ICON_CLASS,
  OTHER_GROUPS_LABEL,
} from '../constants/committees.constants';
import { formatRelativeTime } from './date-time.utils';
import { getEntityCommands } from './entity-route.utils';
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
 * Builds the canonical Angular router commands for a group's view or edit page, prefixing the
 * path with the GROUP's own project tier (`is_foundation`) rather than the viewer's transient
 * active lens: foundation-owned groups live under `/foundation/groups/{uid}`, all other
 * projects under `/project/groups/{uid}`. Returns null when `is_foundation` is absent
 * (unenriched payload) so callers can fall back to the flat `/groups/{uid}` path handled by
 * `lensRedirectGuard`. Pass `leaf: 'edit'` for the edit route.
 *
 * Thin committee-shaped wrapper over {@link getEntityCommands} — the tier/edit/fallback contract
 * lives there alone so the two can never drift (this copy once diverged on null-tier handling);
 * its spec covers the `groups` segment, so no duplicate route-building tests live here.
 */
export function getGroupCommands(committee: Pick<Committee, 'uid' | 'is_foundation'>, leaf?: 'edit'): string[] | null {
  return getEntityCommands('groups', committee.uid, committee.is_foundation, leaf);
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

/** Whether a member has an active "Voting Rep" status (excludes Alternate Voting Rep). */
export function isVotingRep(member: CommitteeMember): boolean {
  return member.voting?.status === CommitteeMemberVotingStatus.VOTING_REP;
}

/** Count of members with an active "Voting Rep" status (excludes Alternate Voting Rep). */
export function countVotingReps(members: CommitteeMember[]): number {
  return members.filter(isVotingRep).length;
}

// ── My Groups card grid (LFXV2-1715) ────────────────────────────────────────

/**
 * Maps a caller's committee role to the badge severity used on the My Groups card grid. Extracted
 * from `MyGroupsCardGridComponent` (no Angular component-test runner exists in this repo — see
 * `apps/lfx-one/vitest.config.ts`) so the 4-branch mapping is unit-tested here instead.
 */
export function resolveGroupsCardRoleSeverity(role: CommitteeMemberRole | 'Member' | undefined): BadgeSeverity {
  switch (role) {
    case CommitteeMemberRole.CHAIR:
      return 'info';
    case CommitteeMemberRole.VICE_CHAIR:
      return 'success';
    case CommitteeMemberRole.LF_STAFF:
      return 'contrast';
    default:
      return 'secondary';
  }
}

// ── All Groups foundation-grouping (LFXV2-1715) ─────────────────────────────

/**
 * Groups an already-filtered All Groups list by resolved label, keyed by `project_uid` when a
 * committee is "named" — both `project_name` **and** `project_uid` resolved (a falsy `project_uid`
 * alongside a populated `project_name` is treated as degraded, not named, so it can't silently key on
 * an empty string and collapse into whichever other committee got there first) — so two genuinely
 * distinct sub-projects that happen to share a display name still render as two buckets (disambiguated
 * by testid slug), never silently merged. A degraded committee (no usable `project_name`/`project_uid`
 * pair) is keyed by its resolved label text instead, whether that label is its own `project_name`,
 * `foundation_name`, or a fallback constant. It merges into an existing named bucket only when the
 * label unambiguously belongs to exactly one named project (e.g. a project literally named "CNCF" and
 * a committee that degrades to `foundation_name: 'CNCF'`); if two distinct named projects share that
 * label, which one the committee "really" belongs to can't be determined, so it falls back to its own
 * label-keyed bucket instead of merging into an arbitrary one.
 *
 * The two source values share one string namespace — a `project_uid` and a resolved label are both
 * arbitrary strings, so a degraded committee's label could otherwise be byte-identical to some other
 * committee's `project_uid` and silently merge into that unrelated bucket. `uidKey`/`labelKey` prefix
 * each domain (`uid:…` / `label:…`) so the two can never collide; `.key` is an internal identifier
 * (expansion-state map key, `@for` track identity) that no caller parses, so the prefix is invisible
 * outside this function.
 *
 * Pure and side-effect-free: callers gate whether grouping applies at all (e.g. only in foundation
 * scope) and decide the input list (e.g. already search/filter-narrowed).
 */
export function groupCommitteesByFoundation(committees: Committee[]): CommitteeFoundationGroup[] {
  const uidKey = (uid: string): string => `uid:${uid}`;
  const labelKey = (label: string): string => `label:${label}`;

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

  // A committee only counts as "named" when both project_name and project_uid resolved — a falsy
  // project_uid (upstream enrichment can leave it '' alongside a populated passthrough project_name,
  // the same failure mode the truthiness guards in committee-dashboard.component.ts already defend
  // against for this field) would otherwise key on the empty string, silently collapsing unrelated
  // committees into one bucket.
  const isNamed = (committee: Committee): committee is Committee & { project_name: string; project_uid: string } =>
    !!committee.project_name && !!committee.project_uid;

  // First pass: named projects get their own project_uid-keyed bucket. Track every distinct named
  // key seen under each label, so a degraded committee (second pass) only merges into a named bucket
  // when the label unambiguously identifies exactly one of them.
  for (const committee of committees) {
    if (!isNamed(committee)) continue;
    addTo(uidKey(committee.project_uid), committee.project_name, committee);
    const keys = namedKeysByLabel.get(committee.project_name) ?? new Set<string>();
    keys.add(committee.project_uid);
    namedKeysByLabel.set(committee.project_name, keys);
  }

  // Second pass: degraded committees (no project_name, or a project_name with no usable project_uid)
  // resolve to foundation_name or a fallback constant, merging into the unique named bucket sharing
  // that label when there is exactly one; otherwise every committee that degrades to the same text
  // shares one label-keyed bucket.
  for (const committee of committees) {
    if (isNamed(committee)) continue;
    const label = committee.project_name || committee.foundation_name || (committee.is_foundation ? FOUNDATION_LEVEL_GROUP_FALLBACK_LABEL : OTHER_GROUPS_LABEL);
    const namedKeys = namedKeysByLabel.get(label);
    const key = namedKeys?.size === 1 ? uidKey([...namedKeys][0]) : labelKey(label);
    addTo(key, label, committee);
  }

  // Assign testid slugs in a key-ordered pass — deterministic and locale-independent (`compareCodeUnits`,
  // not `localeCompare`) — decoupled entirely from display order below. Two *different* labels can
  // collide on the same base slug (e.g. "CNCF" and "CNCF®" both slugify to "cncf"), so numbering by
  // display-sort position would route the '-2' suffix through a locale-aware label comparison; a
  // server/client ICU collation difference could then flip which bucket gets which testid between the
  // SSR HTML and the hydrated DOM. Keys are already unique, and this ordering depends only on them —
  // never on the labels or the display sort below.
  // Track slugs actually emitted (not per-base-slug occurrence counts) — a naive counter can still
  // collide when one bucket's base slug matches another's already-disambiguated suffix, e.g. labels
  // "Alpha Project", "Alpha Project", "Alpha Project 2" would otherwise emit alpha-project,
  // alpha-project-2, alpha-project-2 (duplicate). Walking candidates until one is free is unique by
  // construction regardless of input.
  const slugByKey = new Map<string, string>();
  const usedSlugs = new Set<string>();
  for (const bucket of [...buckets.values()].sort((a, b) => compareCodeUnits(a.key, b.key))) {
    const baseSlug = slugify(bucket.label) || 'group';
    let candidate = baseSlug;
    let suffix = 1;
    while (usedSlugs.has(candidate)) {
      suffix += 1;
      candidate = `${baseSlug}-${suffix}`;
    }
    usedSlugs.add(candidate);
    slugByKey.set(bucket.key, candidate);
  }

  const groups = [...buckets.values()].sort((a, b) => {
    if (a.isFoundationLevel !== b.isFoundationLevel) return a.isFoundationLevel ? -1 : 1;
    // Equal labels happen between distinct named buckets sharing a display name (the deliberate
    // non-merge case), and between those and the label-keyed bucket an ambiguous degraded lookup
    // produces. Break the tie by key — a code-unit comparison, not localeCompare, since keys are
    // opaque identifiers (a project_uid or raw label text) rather than human-readable text.
    if (a.label === b.label) return compareCodeUnits(a.key, b.key);
    if (a.label === OTHER_GROUPS_LABEL) return 1;
    if (b.label === OTHER_GROUPS_LABEL) return -1;
    // Display order is intentionally locale-aware, for correct human reading order — but pinned to a
    // fixed locale ('en') rather than each runtime's default, so this SSR-rendered @for produces the
    // same DOM order on the server and in the browser instead of depending on Node's vs. the browser's
    // default ICU collation. The testid a group gets is assigned above and never depends on this sort.
    return a.label.localeCompare(b.label, 'en');
  });

  // Every bucket key was assigned a slug in the pass above (same `buckets` map, no filtering between
  // the two), so this fallback is unreachable in practice — kept explicit rather than a `!` assertion
  // so a future refactor that breaks the invariant degrades to the raw key instead of throwing.
  return groups.map((group) => ({ ...group, testIdSlug: slugByKey.get(group.key) ?? group.key }));
}

/**
 * Deterministic, locale-independent ordering for opaque identifier strings (not human-readable
 * text — use `localeCompare` for that). Compares UTF-16 code units, not Unicode code points, so
 * astral-plane characters don't sort in true code-point order — irrelevant here since the only
 * requirement is a stable, environment-independent order, not a "correct" one.
 */
function compareCodeUnits(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

// ── Groups dashboard engagement stat cards (LFXV2-1711) ─────────────────────

/**
 * Builds the Active Members / Meetings This Month stat cards from the engagement-stats rollup.
 * Extracted as a pure function (no Angular component-test runner exists in this repo — see
 * `resolveGroupsCardRoleSeverity` above) so all render states are unit-tested directly: loading
 * (em-dash, no sub-line), populated (value + relative-time freshness label), mock-sourced (value +
 * a "Sample data" marker instead of a freshness label, so fabricated fixture numbers can never be
 * mistaken for live ones), degraded (fetch failed, or the count is null — em-dash + "Unavailable",
 * never throws, never blocks the rest of the dashboard), and partial-coverage (LFXV2-2978 — Active
 * Members only, since `active_members` is the only field whose count can be real-but-incomplete:
 * its sub-line gains "· across N of M groups" alongside the freshness/mock label; Meetings This
 * Month never carries this qualifier).
 */
export function buildEngagementStatCards(stats: GroupsEngagementStats | null, loading: boolean): StatCardItem[] {
  const activeMembersCard: StatCardItem = {
    label: 'Active Members',
    icon: 'fa-light fa-user-group',
    iconContainerClass: GROUPS_ENGAGEMENT_ICON_CLASS.activeMembers,
    value: '—',
  };
  const meetingsThisMonthCard: StatCardItem = {
    label: 'Meetings This Month',
    icon: 'fa-light fa-calendar-check',
    iconContainerClass: GROUPS_ENGAGEMENT_ICON_CLASS.meetingsThisMonth,
    value: '—',
  };

  if (loading) {
    return [activeMembersCard, meetingsThisMonthCard];
  }

  // Mock-sourced values get "Sample data" instead of a freshness label — deliberately more visible
  // than a subtle provenance flag, since the whole point is that a fabricated fixture number must
  // never be mistaken for live data during manual validation (including against synced prod data,
  // where NODE_ENV isn't 'production' but a stray ENGAGEMENT_BACKEND=mock could still be set).
  const subLineForValue = resolveEngagementSubLine(stats);

  // Each card degrades independently: active_members and meetings_this_month are separate
  // aggregates (trailing-30-day attendance vs. current-month occurrences), so a partially-deployed
  // dbt model could plausibly resolve one without the other — neither field's availability implies
  // the other's.
  const resolveCard = (base: StatCardItem, value: number | null, subLine: string | undefined): StatCardItem =>
    value === null ? { ...base, subLine: 'Unavailable' } : { ...base, value, subLine };

  return [
    resolveCard(activeMembersCard, stats?.active_members ?? null, resolveActiveMembersSubLine(stats, subLineForValue)),
    resolveCard(meetingsThisMonthCard, stats?.meetings_this_month ?? null, subLineForValue),
  ];
}

/** Extracted to avoid nesting a ternary inside another ternary's branch (`stats && source === 'mock' ? … : stats ? … : …`). */
function resolveEngagementSubLine(stats: GroupsEngagementStats | null): string | undefined {
  if (!stats) return undefined;
  if (stats.source === 'mock') return 'Sample data';
  return `Updated ${formatRelativeTime(new Date(stats.computed_at))}`;
}

/**
 * Active Members is the only card whose count can be a real-but-partial one (LFXV2-2978) — coverage
 * is a property of *which committees* fed the count, not of meetings-this-month, so this qualifier
 * is deliberately not shared with the sibling card via `resolveEngagementSubLine`. Appends to the
 * base sub-line (rather than replacing it) so the freshness/mock provenance stays visible alongside
 * the disclosure. Full coverage (`covered === total`, always true for mock) renders no qualifier —
 * identical to the sibling card's plain sub-line. `stats.coverage` is optional-chained (not just a
 * `stats` null check) — a rolling deploy can put this client bundle in front of a pre-upgrade server
 * instance whose response predates `coverage`, and that shape drift must degrade to the plain
 * sub-line, not throw inside the `computed()` this feeds (which would blank the whole stat-card row).
 */
function resolveActiveMembersSubLine(stats: GroupsEngagementStats | null, baseSubLine: string | undefined): string | undefined {
  if (!stats?.coverage || stats.coverage.covered >= stats.coverage.total) return baseSubLine;
  return `${baseSubLine} · across ${stats.coverage.covered} of ${stats.coverage.total} groups`;
}
