// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { OrgLeaderboardDetailCategory, OrgLeaderboardDetailMethodology } from '../interfaces/org-leaderboard-detail-drawer.interface';

/**
 * Display metadata for the leaderboard-row score-breakdown drawer: which categories each dimension
 * scores, their labels, which of them are withheld from callers outside the subject organization,
 * and the methodology copy. The figures themselves come from the BFF breakdown endpoints.
 *
 * The category lists must stay in step with the warehouse model's scored components — a component
 * added upstream but missing here would silently leave part of the score unexplained. The list sizes
 * are asserted against `ORG_LEADERBOARD_DETAIL_SCORED_COMPONENT_COUNTS` so that drifts as a test
 * failure rather than as a breakdown whose rows quietly stop adding up.
 */

/** Technical-influence categories — the only four that earn points. */
export const ORG_LEADERBOARD_DETAIL_TECHNICAL_CATEGORIES: OrgLeaderboardDetailCategory[] = [
  { key: 'maintainer', name: 'Maintainers' },
  { key: 'contributors', name: 'Contributors' },
  { key: 'commits', name: 'Commit Activities' },
  { key: 'prs', name: 'PRs Opened' },
];

/** Ecosystem-influence categories, including the membership tier that also earns ecosystem points. */
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
  { key: 'tier', name: 'Membership Tier' },
];

/** How many components the warehouse sums into each dimension's total score. */
export const ORG_LEADERBOARD_DETAIL_SCORED_COMPONENT_COUNTS: Record<'technical' | 'ecosystem', number> = {
  technical: 4,
  ecosystem: 10,
};

/**
 * Category keys whose counts, points, and share percentages are served only to the subject
 * organization's own members. The server omits them for everyone else; this list is what it omits by.
 *
 * These are the categories backed by data that is NOT publicly available — individual-level
 * participation records held by LFX (meeting, event, and meetup attendance; certifications). The
 * remaining categories are all derivable from public sources: technical activity from public GitHub
 * repos, and committee/board rosters, event speakers, event sponsorships, and membership tiers from
 * published governance pages, conference schedules, sponsor listings, and member directories.
 */
export const ORG_LEADERBOARD_DETAIL_WITHHELD_CATEGORY_KEYS: readonly string[] = ['certified', 'event', 'meetup', 'meeting'];

/**
 * Per-category tooltip copy naming the specific non-public data source behind each withheld row.
 * Keyed by category key; `ORG_LEADERBOARD_DETAIL_WITHHELD_CATEGORY_TOOLTIP_FALLBACK` covers any key
 * the server withholds without its own copy.
 */
export const ORG_LEADERBOARD_DETAIL_WITHHELD_CATEGORY_TOOLTIPS: Record<string, string> = {
  meeting: 'Meeting attendance comes from private LFX Meetings attendance records, so these figures are only shown for your own organization.',
  event: 'Event attendance comes from private event registration records, so these figures are only shown for your own organization.',
  meetup: 'Meetup attendance comes from private registration records, so these figures are only shown for your own organization.',
  certified: 'Certification records identify individuals, so these figures are only shown for your own organization.',
};

/** Tooltip copy for a withheld category with no specific entry in `ORG_LEADERBOARD_DETAIL_WITHHELD_CATEGORY_TOOLTIPS`. */
export const ORG_LEADERBOARD_DETAIL_WITHHELD_CATEGORY_TOOLTIP_FALLBACK =
  'This category is based on data that is not publicly available, so these figures are only shown for your own organization.';

/** Categories scored without a count — a point award, not a share of project activity. */
export const ORG_LEADERBOARD_DETAIL_UNCOUNTED_CATEGORY_TOOLTIPS: Record<string, string> = {
  tier: "Points come from the organization's LF membership tier, so there is no activity count behind this row.",
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
      { label: 'Membership Tier', text: '— 1 pt for Premier, 0.66 pt for Strategic, else 0. No activity count applies.' },
    ],
    levelMapping: 'Total score maps to a level: 0–2 = Silent, 3–10 = Participating, 11–19 = Contributing, 20+ = Leading.',
  },
};
