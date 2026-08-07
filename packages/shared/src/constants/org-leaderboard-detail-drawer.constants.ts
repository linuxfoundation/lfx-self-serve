// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  OrgLeaderboardDetailCategory,
  OrgLeaderboardDetailCompany,
  OrgLeaderboardDetailMethodology,
} from '../interfaces/org-leaderboard-detail-drawer.interface';

/**
 * DEMO/PLACEHOLDER DATA — LFXV2-2934.
 *
 * The leaderboard-row detail drawer (score breakdown by category) has no real per-category
 * count/points data source yet — that requires a Snowflake-backed pass tracked as a separate future
 * ticket. Everything below (categories, per-company points/counts, methodology copy) is illustrative
 * placeholder content only, keyed by org display name (the leaderboard row has no stable org id to
 * key on), so the drawer can be built and reviewed against the real UX now. When the real data
 * source lands, replace the two `ORG_LEADERBOARD_DETAIL_*_COMPANIES` lookup maps with a service call
 * and this file's exports can be deleted — the drawer component only depends on the shapes in
 * `org-leaderboard-detail-drawer.interface.ts`, not on this file directly being the source.
 */

/** Technical-influence categories per the real scoring methodology — the only four that earn points. */
export const ORG_LEADERBOARD_DETAIL_TECHNICAL_CATEGORIES: OrgLeaderboardDetailCategory[] = [
  { key: 'maintainer', name: 'Maintainers' },
  { key: 'contributors', name: 'Contributors' },
  { key: 'commits', name: 'Commit Activities' },
  { key: 'prs', name: 'PRs Opened' },
];

/** Ecosystem-influence categories per the real scoring methodology. */
export const ORG_LEADERBOARD_DETAIL_ECOSYSTEM_CATEGORIES: OrgLeaderboardDetailCategory[] = [
  { key: 'collab', name: 'Collaboration Activity' },
  { key: 'meeting', name: 'Meeting Attendance' },
  { key: 'event', name: 'Event Attendance' },
  { key: 'committee', name: 'Committee Members' },
  { key: 'board', name: 'Board Members' },
  { key: 'speakers', name: 'Event Speakers' },
  { key: 'meetup', name: 'Meetup Attendance' },
  { key: 'sponsor', name: 'Event Sponsorships' },
  { key: 'certified', name: 'Certified Individuals' },
];

/**
 * Category keys whose counts, points, and share percentages are only shown for the viewer's own org.
 *
 * These are the categories backed by data that is NOT publicly available — individual-level
 * participation records held by LFX (meeting, event, and meetup attendance; certifications). The
 * unmasked categories are all derivable from public sources: technical activity from public GitHub
 * repos, and committee/board rosters, event speakers, and event sponsorships from published
 * governance pages, conference schedules, and sponsor listings.
 */
export const ORG_LEADERBOARD_DETAIL_MASKED_CATEGORY_KEYS: readonly string[] = ['certified', 'event', 'meetup', 'meeting'];

/**
 * Per-category tooltip copy naming the specific non-public data source behind each masked row.
 * Keyed by category key; `ORG_LEADERBOARD_DETAIL_MASKED_CATEGORY_TOOLTIP_FALLBACK` covers any key
 * added to the masked list without its own copy.
 */
export const ORG_LEADERBOARD_DETAIL_MASKED_CATEGORY_TOOLTIPS: Record<string, string> = {
  meeting: 'Meeting attendance comes from private LFX Meetings attendance records, so these figures are only shown for your own organization.',
  event: 'Event attendance comes from private event registration records, so these figures are only shown for your own organization.',
  meetup: 'Meetup attendance comes from private registration records, so these figures are only shown for your own organization.',
  certified: 'Certification records identify individuals, so these figures are only shown for your own organization.',
};

/** Tooltip copy for a masked category with no specific entry in `ORG_LEADERBOARD_DETAIL_MASKED_CATEGORY_TOOLTIPS`. */
export const ORG_LEADERBOARD_DETAIL_MASKED_CATEGORY_TOOLTIP_FALLBACK =
  'This category is based on data that is not publicly available, so these figures are only shown for your own organization.';

/** DEMO DATA — illustrative per-company technical-influence breakdown, keyed by org display name. */
export const ORG_LEADERBOARD_DETAIL_TECHNICAL_COMPANIES: Record<string, OrgLeaderboardDetailCompany> = {
  Google: {
    rank: 1,
    activityPct: 31,
    score: 104,
    points: { maintainer: 6, contributors: 22, commits: 52, prs: 24 },
    counts: { maintainer: 1, contributors: 218, commits: 3842, prs: 296 },
  },
  'Red Hat': {
    rank: 2,
    activityPct: 24,
    score: 98,
    points: { maintainer: 18, contributors: 32, commits: 30, prs: 18 },
    counts: { maintainer: 3, contributors: 314, commits: 2210, prs: 221 },
  },
  IBM: {
    rank: 3,
    activityPct: 13,
    score: 71,
    points: { maintainer: 22, contributors: 23, commits: 16, prs: 10 },
    counts: { maintainer: 4, contributors: 226, commits: 1182, prs: 123 },
  },
  VMware: {
    rank: 4,
    activityPct: 9,
    score: 58,
    points: { maintainer: 15, contributors: 20, commits: 14, prs: 9 },
    counts: { maintainer: 2, contributors: 196, commits: 1034, prs: 111 },
  },
  Microsoft: {
    rank: 5,
    activityPct: 21,
    score: 68,
    points: { maintainer: 6, contributors: 20, commits: 26, prs: 16 },
    counts: { maintainer: 1, contributors: 197, commits: 1921, prs: 197 },
  },
  Intel: {
    rank: 6,
    activityPct: 11,
    score: 47,
    points: { maintainer: 6, contributors: 14, commits: 18, prs: 9 },
    counts: { maintainer: 1, contributors: 137, commits: 1330, prs: 111 },
  },
  Cisco: {
    rank: 7,
    activityPct: 6,
    score: 34,
    points: { maintainer: 5, contributors: 10, commits: 12, prs: 7 },
    counts: { maintainer: 1, contributors: 98, commits: 887, prs: 86 },
  },
  D2iQ: {
    rank: 8,
    activityPct: 3,
    score: 22,
    points: { maintainer: 3, contributors: 6, commits: 8, prs: 5 },
    counts: { maintainer: 1, contributors: 59, commits: 591, prs: 62 },
  },
};

/** DEMO DATA — illustrative per-company ecosystem-influence breakdown, keyed by org display name. */
export const ORG_LEADERBOARD_DETAIL_ECOSYSTEM_COMPANIES: Record<string, OrgLeaderboardDetailCompany> = {
  'Red Hat': {
    rank: 1,
    activityPct: 22,
    score: 96,
    points: { collab: 40, meeting: 12, event: 10, committee: 12, board: 9, speakers: 7, meetup: 3, sponsor: 2, certified: 1 },
    counts: { collab: 812, meeting: 145, event: 28, committee: 14, board: 2, speakers: 19, meetup: 9, sponsor: 3, certified: 12 },
  },
  Google: {
    rank: 2,
    activityPct: 27,
    score: 88,
    points: { collab: 46, meeting: 8, event: 12, committee: 4, board: 2, speakers: 9, meetup: 5, sponsor: 1, certified: 1 },
    counts: { collab: 934, meeting: 97, event: 34, committee: 5, board: 0, speakers: 24, meetup: 15, sponsor: 2, certified: 8 },
  },
  IBM: {
    rank: 3,
    activityPct: 15,
    score: 91,
    points: { collab: 12, meeting: 16, event: 6, committee: 19, board: 18, speakers: 8, meetup: 4, sponsor: 5, certified: 3 },
    counts: { collab: 244, meeting: 193, event: 17, committee: 22, board: 3, speakers: 21, meetup: 11, sponsor: 6, certified: 27 },
  },
  VMware: {
    rank: 4,
    activityPct: 11,
    score: 62,
    points: { collab: 18, meeting: 7, event: 5, committee: 6, board: 4, speakers: 5, meetup: 2, sponsor: 2, certified: 2 },
    counts: { collab: 366, meeting: 85, event: 14, committee: 7, board: 1, speakers: 13, meetup: 6, sponsor: 3, certified: 15 },
  },
  Microsoft: {
    rank: 5,
    activityPct: 18,
    score: 79,
    points: { collab: 28, meeting: 10, event: 14, committee: 5, board: 3, speakers: 12, meetup: 4, sponsor: 2, certified: 1 },
    counts: { collab: 571, meeting: 121, event: 39, committee: 6, board: 1, speakers: 31, meetup: 10, sponsor: 3, certified: 9 },
  },
  Intel: {
    rank: 6,
    activityPct: 9,
    score: 54,
    points: { collab: 14, meeting: 9, event: 4, committee: 8, board: 7, speakers: 4, meetup: 3, sponsor: 3, certified: 2 },
    counts: { collab: 284, meeting: 109, event: 11, committee: 9, board: 2, speakers: 10, meetup: 8, sponsor: 4, certified: 14 },
  },
  Cisco: {
    rank: 7,
    activityPct: 7,
    score: 41,
    points: { collab: 10, meeting: 6, event: 4, committee: 5, board: 4, speakers: 4, meetup: 3, sponsor: 3, certified: 2 },
    counts: { collab: 202, meeting: 73, event: 11, committee: 6, board: 1, speakers: 10, meetup: 8, sponsor: 4, certified: 13 },
  },
  D2iQ: {
    rank: 8,
    activityPct: 4,
    score: 26,
    points: { collab: 8, meeting: 3, event: 3, committee: 3, board: 2, speakers: 3, meetup: 2, sponsor: 1, certified: 1 },
    counts: { collab: 162, meeting: 36, event: 8, committee: 4, board: 0, speakers: 8, meetup: 5, sponsor: 2, certified: 6 },
  },
};

/** Condensed "Company influence metrics" methodology copy shown in the drawer, per dimension. */
export const ORG_LEADERBOARD_DETAIL_METHODOLOGY: Record<'technical' | 'ecosystem', OrgLeaderboardDetailMethodology> = {
  technical: {
    intro:
      'Only four categories earn technical-influence points. Each earns points independently — there are no preset weights per category. Points from all categories are added together to get the total score.',
    bullets: [
      { label: 'Maintainers', text: '— 10 pts if the company has 1+ project maintainers, else 0.' },
      {
        label: 'Contributors, Commit Activities, PRs Opened',
        text: '— each 0.1% share of the project total earns 0.1 pt, plus a +1 bonus for any share above 0%.',
      },
    ],
    levelMapping: 'Total score maps to a level: 0 = Silent, 1–4 = Participating, 5–14 = Contributing, 15+ = Leading.',
  },
  ecosystem: {
    intro:
      'Each category below earns points independently — there are no preset weights per category. Points from all categories are added together to get the total score.',
    bullets: [
      {
        label: 'Collaboration Activity, Meeting Attendance, Committee Members, Event Speakers',
        text: '— each 0.1% share of the project/foundation total earns 0.1 pt, plus a +1 bonus for any share above 0%.',
      },
      { label: 'Board Members', text: '— 1 pt if the company has 1+ foundation board members, else 0.' },
      {
        label: 'Event Attendance, Event Sponsorships, Meetup Attendance, Certified Individuals',
        text: '— tiered by share: 0 / 0.33 / 0.66 / 1 pt for none / up to 25% / up to 50% / over 50%.',
      },
    ],
    levelMapping: 'Total score maps to a level: 0–2 = Silent, 3–10 = Participating, 11–19 = Contributing, 20+ = Leading.',
  },
};
