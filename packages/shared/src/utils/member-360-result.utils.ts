// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CATEGORY_LABELS, MEMBER_360_ACTION_TEAM_ORDER, MEMBER_360_HEAT_ORDER, MEMBER_360_PRIORITY_ORDER } from '../constants/member-360.constants';
import type { Member360ActionTeam, Member360Category, Member360Envelope, Member360EvidenceGroup, Member360WeightRow } from '../interfaces/member-360.interface';

type Tabs = Member360Envelope['tabs'];
type Action = Tabs['actions_by_team'][number];
type Evidence = Tabs['evidence'][number];
type Method = Tabs['method'];

/**
 * The agent opens many actions with the team that owns them ("Marketing: …", "Mktg owner: …",
 * "Member Success: …", "Case-study owner: …"). Under the team's own heading that label repeats, so
 * the page drops a leading label that names a team or an owner; everything after it is kept as written.
 */
const OWNER_LABEL = /^\s*(?:(?:[A-Za-z][\w-]*\s){0,2}owner|marketing|mktg|sales|member success)\s*:\s*/i;

export function member360ActionText(action: Pick<Action, 'recommended_action'>): string {
  const text = action.recommended_action.replace(OWNER_LABEL, '');
  return text.length > 0 ? text.charAt(0).toUpperCase() + text.slice(1) : action.recommended_action;
}

const priorityRank = (priority: Action['priority']): number => {
  const index = (MEMBER_360_PRIORITY_ORDER as readonly string[]).indexOf(priority);
  return index === -1 ? MEMBER_360_PRIORITY_ORDER.length : index;
};

/** Actions by team in renewal order (Sales, Marketing, Member Success): High first, then nearest deadline, then name. */
export function member360ActionTeams(actions: readonly Action[]): Member360ActionTeam[] {
  return MEMBER_360_ACTION_TEAM_ORDER.map((owner) => {
    const own = actions
      .filter((action) => action.owner === owner)
      .sort(
        (a, b) =>
          priorityRank(a.priority) - priorityRank(b.priority) ||
          (a.suggested_deadline ?? '9999-12-31').localeCompare(b.suggested_deadline ?? '9999-12-31') ||
          a.member_organization.localeCompare(b.member_organization)
      );
    const priorityCounts = MEMBER_360_PRIORITY_ORDER.map((priority) => ({
      priority,
      count: own.filter((action) => action.priority === priority).length,
    })).filter((entry) => entry.count > 0);
    const deadlines = own.map((action) => action.suggested_deadline).filter((date): date is string => date !== null);
    return { key: owner.toLowerCase().replace(/ /g, '-'), owner, actions: own, priorityCounts, nextDue: deadlines.length ? [...deadlines].sort()[0] : null };
  });
}

/** Evidence grouped by category, largest first; rows keep their order within a category. */
export function member360EvidenceGroups(evidence: readonly Evidence[]): Member360EvidenceGroup[] {
  const groups = new Map<Member360Category, Evidence[]>();
  for (const row of evidence) {
    const rows = groups.get(row.category);
    if (rows) rows.push(row);
    else groups.set(row.category, [row]);
  }
  return [...groups.entries()]
    .map(([key, rows]) => ({ key, label: CATEGORY_LABELS[key], rows }))
    .sort((a, b) => b.rows.length - a.rows.length || a.label.localeCompare(b.label));
}

/** Where an evidence row came from, in words: known LFX tools are named by what they read; anything else is shown as written. */
const EVIDENCE_SOURCES: ReadonlyArray<[RegExp, string]> = [
  [/lfx_mcp_search_committee_members/, 'LFX · committee seats'],
  [/lfx_mcp_search_committees/, 'LFX · committees'],
  [/lfx_mcp_query_lfx_standard_metrics/, 'LFX · event and speaker metrics'],
  [/lfx_mcp_search_past_meeting_participants|lfx_mcp_search_past_meetings/, 'LFX · meetings'],
  [/lfx_mcp_get_member_membership|lfx_mcp_search_members/, 'LFX · membership'],
];
export function member360EvidenceSource(source: string): string {
  return EVIDENCE_SOURCES.find(([pattern]) => pattern.test(source))?.[1] ?? source;
}

/**
 * The weight each scoring category carried, in the heat-strip order. A category is "no data" only when the run
 * lists it in categories_no_data (with its reason); a category weighted 0% on purpose keeps its bar at 0%.
 */
export function member360WeightRows(method: Pick<Method, 'weights_used' | 'weights_default' | 'categories_no_data'>): Member360WeightRow[] {
  const reasons = new Map(method.categories_no_data.map((entry) => [entry.category, entry.reason]));
  const shown = wholePercents(MEMBER_360_HEAT_ORDER.map((key) => method.weights_used[key]));
  return MEMBER_360_HEAT_ORDER.map((key, index) => ({
    key,
    label: CATEGORY_LABELS[key],
    used: method.weights_used[key],
    shownPercent: shown[index],
    default: method.weights_default[key],
    noDataReason: reasons.get(key) ?? null,
  }));
}

/** Whole percents that add up to the rounded total (36.37 / 36.36 / 27.27 show as 37 / 36 / 27, not 36 / 36 / 27 = 99). */
function wholePercents(values: readonly number[]): number[] {
  const floors = values.map((value) => Math.floor(value));
  let missing = Math.round(values.reduce((sum, value) => sum + value, 0)) - floors.reduce((sum, value) => sum + value, 0);
  const byRemainder = values
    .map((value, index) => ({ index, remainder: value - floors[index] }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (const { index } of byRemainder) {
    if (missing <= 0) break;
    floors[index] += 1;
    missing -= 1;
  }
  return floors;
}

/** A tier baseline group without the project-name prefix and the word "Membership": "Gold", "Silver (100 - 499)". */
export function member360TierGroupLabel(group: string, projectName: string): string {
  const withoutProject = projectName && group.startsWith(`${projectName} - `) ? group.slice(projectName.length + 3) : group;
  const short = withoutProject
    .replace(/\bMembership\b/i, '')
    .replace(/ {2,}/g, ' ')
    .trim();
  return short.length > 0 ? short : group;
}

/**
 * The calendar quarter of an ISO date or timestamp, as "Q4 2026", in the viewer's local time: the same clock the
 * date pipe renders beside it, so a row never reads "Q4 2026 · 30 Sep". Null for a missing or unreadable date.
 */
export function member360QuarterLabel(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return `Q${Math.floor(date.getMonth() / 3) + 1} ${date.getFullYear()}`;
}
