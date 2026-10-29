// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  OrgAccessListResponse,
  OrgAccessRole,
  OrgAccessTypeFilterOption,
  OrgAllEmployeeActivityOption,
  OrgAllEmployeeEmploymentFilter,
  OrgAllEmployeeEmploymentOption,
  OrgAllEmployeesResponse,
  OrgAllEmployeeStats,
  OrgContributorsResponse,
  OrgContributorStatsBaseline,
  OrgEmploymentFilter,
  OrgEmploymentOption,
  OrgEventAttendeesResponse,
  OrgTeamMembersFilter,
  OrgTeamMembersOption,
  OrgTraineesResponse,
  PeopleTabConfig,
  PeopleTabId,
} from '../interfaces';
import { ORG_LENS_DEFAULT_TIME_RANGE } from './org-lens-time-range.constants';

/** Org People page tabs in visible order (`all` is the default). */
export const PEOPLE_TABS: readonly PeopleTabConfig[] = [
  { id: 'all', label: 'All Employees', icon: 'fa-light fa-users', noun: 'all employees' },
  { id: 'board', label: 'Board', icon: 'fa-light fa-user-tie', noun: 'board members' },
  { id: 'committee', label: 'Committee', icon: 'fa-light fa-users-rectangle', noun: 'committee members' },
  { id: 'contacts', label: 'Key Contacts', icon: 'fa-light fa-address-card', noun: 'key contacts' },
  { id: 'contributors', label: 'Contributors', icon: 'fa-light fa-code', noun: 'contributors' },
  { id: 'events', label: 'Event Attendees', icon: 'fa-light fa-calendar', noun: 'event attendees' },
  { id: 'training', label: 'Trainees', icon: 'fa-light fa-graduation-cap', noun: 'trainees' },
  // Spec 025 — Org Lens Access is always the LAST tab.
  { id: 'access', label: 'Org Lens Access', icon: 'fa-light fa-shield-halved', noun: 'org lens access' },
] as const;

/** Default tab — URL drops `?tab=` when active to keep deep links clean. */
export const DEFAULT_PEOPLE_TAB_ID: PeopleTabId = 'all';

/** Derived from PEOPLE_TABS; used to validate `?tab=` query-param input. */
export const VALID_PEOPLE_TAB_IDS: ReadonlySet<PeopleTabId> = new Set(PEOPLE_TABS.map((t) => t.id));

/** Initial visible-row cap on the All Employees table before "Show All" is clicked. */
export const ORG_ALL_EMPLOYEES_INITIAL_LIMIT = 30;

/** Display name of a roster row whose stored name is blank or a bracketed placeholder and that carries no address. */
export const ORG_PEOPLE_UNKNOWN_MEMBER_NAME = 'Unknown member';

/** Zero-valued OrgAllEmployeeStats — fallback when the stats query returns no rows. */
export const EMPTY_ORG_ALL_EMPLOYEE_STATS: OrgAllEmployeeStats = {
  activeInOss: 0,
  inGovernance: 0,
  codeContributors: 0,
  eventAttendees: 0,
  trainees: 0,
};

/** Zero-valued OrgAllEmployeesResponse — used as the toSignal initialValue and the empty-account fallback. */
export const EMPTY_ORG_ALL_EMPLOYEES_RESPONSE: OrgAllEmployeesResponse = {
  accountId: '',
  rows: [],
  stats: EMPTY_ORG_ALL_EMPLOYEE_STATS,
  foundations: [],
};

/** Activity-filter dropdown options for the All Employees table. */
export const ORG_ALL_EMPLOYEE_ACTIVITY_OPTIONS: readonly OrgAllEmployeeActivityOption[] = [
  { label: 'All Activity', value: 'all' },
  { label: 'Board & Committee', value: 'governance' },
  { label: 'Code Contributions', value: 'code' },
  { label: 'Events', value: 'events' },
  { label: 'Training', value: 'training' },
] as const;

/** Employment-filter dropdown options for the All Employees table (lfx-self-serve#4311). */
export const ORG_ALL_EMPLOYEE_EMPLOYMENT_OPTIONS: readonly OrgAllEmployeeEmploymentOption[] = [
  { label: 'Current employees', value: 'current' },
  { label: 'Former employees', value: 'former' },
  { label: 'All employees', value: 'all' },
] as const;

/**
 * Default employment filter on All Employees — everyone credited to the org at the time, as LFX Insights counts
 * (lfx-self-serve#4694). The URL drops `?employment=` when it is active.
 */
export const DEFAULT_ORG_ALL_EMPLOYEE_EMPLOYMENT: OrgAllEmployeeEmploymentFilter = 'all';

/**
 * Hint on an All Employees row for someone with code credited to the company but no employment record there
 * (lfx-self-serve#4730): neither current nor former, so listed only under "All employees".
 */
export const ORG_ALL_EMPLOYEE_UNCLASSIFIED_ROW_NOTE =
  'No employment record at this company: listed for code credited to it, only under "All employees", not as a current or former employee.';

/** Employment-filter dropdown options for any People tab — the All Employees options, one list for every tab. */
export const ORG_EMPLOYMENT_OPTIONS: readonly OrgEmploymentOption[] = ORG_ALL_EMPLOYEE_EMPLOYMENT_OPTIONS;

/** Accessible label of a People tab's employment filter. */
export const ORG_EMPLOYMENT_LABEL = 'Employment';

/**
 * Default employment filter on People → Contributors and Org Lens Access (lfx-self-serve#4627) — the URL drops
 * `?employment=` when it is active. Everyone, former employees included: Contributors keeps matching the Overview's
 * Active Contributors card, and Access lists every principal. All Employees has the same default.
 */
export const DEFAULT_ORG_EMPLOYMENT: OrgEmploymentFilter = 'all';

/**
 * Team members filter on People → Contributors, People → All Employees and the Code Contributions page
 * (lfx-self-serve#4685): people marked as team members in the Community Data Platform (CDP). Excluded by default,
 * on LFX Insights' rule, which leaves them out of code-based numbers only: code counts, contributors and maintainer
 * roles. Seats, events and training are not affected. The Overview's contributors and maintainer roles follow the default.
 */
export const ORG_TEAM_MEMBERS_OPTIONS: readonly OrgTeamMembersOption[] = [
  { label: 'Exclude team members', value: 'exclude' },
  { label: 'Include team members', value: 'include' },
] as const;

/** Default team members filter — the URL drops `?teamMembers=` when it is active. */
export const DEFAULT_ORG_TEAM_MEMBERS: OrgTeamMembersFilter = 'exclude';

/** URL query parameter of the team members filter. */
export const ORG_TEAM_MEMBERS_QUERY_PARAM = 'teamMembers';

/** Accessible label of the team members filter. */
export const ORG_TEAM_MEMBERS_LABEL = 'Team members';

/** Tooltip on the team members filter. */
export const ORG_TEAM_MEMBERS_TOOLTIP =
  'People marked as team members in the Community Data Platform. LFX Insights leaves them out of code contributions and maintainer roles; Org Lens does too by default. Seats, events and training are not affected.';

/** Note shown when Exclude team members is picked but the team-member data cannot be read (lfx-self-serve#4685). */
export const ORG_TEAM_MEMBERS_UNAVAILABLE_NOTE = 'Team-member data is unavailable; counts include team members.';

/** Hint on the Contributors empty state at the default view, where team members are excluded and may be the only coders (lfx-self-serve#4685). */
export const ORG_TEAM_MEMBERS_EMPTY_HINT = 'CDP team members are excluded. Choose Include team members to see them.';

/** The person-level CDP team-member flag lf-dbt adds to the Org Lens People, code and maintainer-roles models (lfx-self-serve#4685). */
export const ORG_CDP_TEAM_MEMBER_COLUMN = 'IS_CDP_TEAM_MEMBER';

// Trainees tab (LFXV2-1876) — bulk-load + client-side filter pattern.

/** Initial visible-row cap on the Trainees table before "Show All" is clicked. */
export const ORG_TRAINEES_INITIAL_LIMIT = 30;

/** Zero-valued Trainees response — `toSignal` initialValue + empty-account fallback. */
export const EMPTY_ORG_TRAINEES_RESPONSE: OrgTraineesResponse = {
  accountId: '',
  timeRange: ORG_LENS_DEFAULT_TIME_RANGE,
  trainees: [],
  details: [],
  foundationOptions: [],
  courseOptions: [],
};

// Event Attendees tab (LFXV2-1875) — same bundle-then-client-filter pattern as Trainees.

/** Initial visible-row cap on the Event Attendees table before "Show All" is clicked. */
export const ORG_EVENT_ATTENDEES_INITIAL_LIMIT = 30;

/** Zero-valued Event Attendees response — `toSignal` initialValue + empty-account fallback. */
export const EMPTY_ORG_EVENT_ATTENDEES_RESPONSE: OrgEventAttendeesResponse = {
  accountId: '',
  attendees: [],
  details: [],
  foundationOptions: [],
  eventOptions: [],
};

// Contributors tab (LFXV2-1874) — A1: one BFF slice per range, filter trio client-side; stats anchored on BFF (Item 3).

/** Initial visible-row cap on the Contributors table before "Show All" is clicked. */
export const ORG_CONTRIBUTORS_INITIAL_LIMIT = 30;

/** Zero-valued Contributors stats baseline — fallback when stats query returns no rows. */
export const EMPTY_ORG_CONTRIBUTOR_STATS: OrgContributorStatsBaseline = {
  maintainerRoles: 0,
  contributors: 0,
  projects: 0,
  foundations: 0,
};

/** Zero-valued Contributors response — `toSignal` initialValue + empty-account fallback. */
export const EMPTY_ORG_CONTRIBUTORS_RESPONSE: OrgContributorsResponse = {
  accountId: '',
  timeRange: ORG_LENS_DEFAULT_TIME_RANGE,
  contributors: [],
  projects: [],
  foundationOptions: [],
  projectOptions: [],
  stats: EMPTY_ORG_CONTRIBUTOR_STATS,
};

// Org Lens Access tab (spec 025) ----------------------------------------------

/** Single-select Type-filter options (wireframe labels); semantics in specs/025-org-lens-access-tab (FR-007a). */
export const ORG_ACCESS_TYPE_FILTER_OPTIONS: readonly OrgAccessTypeFilterOption[] = [
  { label: 'All types', value: 'all' },
  { label: 'Org Admin - Editor', value: 'admin' },
  { label: 'Org Admin - Viewer', value: 'viewer' },
  { label: 'Invited', value: 'invited' },
] as const;

/** Initial visible-row cap before "Show all N users" is clicked (reuses the All-Employees cap). */
export const ORG_ACCESS_INITIAL_LIMIT = ORG_ALL_EMPLOYEES_INITIAL_LIMIT;

/** UI role → FGA/settings relation (`invited_as`). */
export const ORG_ACCESS_ROLE_RELATION: Readonly<Record<OrgAccessRole, 'writer' | 'auditor'>> = {
  admin: 'writer',
  viewer: 'auditor',
} as const;

/** Settings relation (`invited_as`) → UI role. */
export const ORG_ACCESS_RELATION_ROLE: Readonly<Record<'writer' | 'auditor', OrgAccessRole>> = {
  writer: 'admin',
  auditor: 'viewer',
} as const;

/** Compact row-badge label per UI role. */
export const ORG_ACCESS_ROLE_BADGE_LABEL: Readonly<Record<OrgAccessRole, string>> = {
  admin: 'Admin',
  viewer: 'Viewer',
} as const;

/** Info-tooltip copy per role badge (FR-005). */
export const ORG_ACCESS_ROLE_BADGE_TOOLTIP: Readonly<Record<OrgAccessRole, string>> = {
  admin: 'Org Admin – Editor: can view and manage this organization in Org Lens.',
  viewer: 'Org Admin – Viewer: read-only access to this organization in Org Lens.',
} as const;

/** Empty list payload — used as the initial value and the no-account fallback. */
export const EMPTY_ORG_ACCESS_LIST_RESPONSE: OrgAccessListResponse = {
  orgUid: '',
  users: [],
  summary: { totalUsers: 0, administrators: 0, viewers: 0 },
  canManage: false,
};
