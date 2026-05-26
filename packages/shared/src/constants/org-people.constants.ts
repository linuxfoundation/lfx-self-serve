// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type {
  OrgAllEmployeeActivityOption,
  OrgAllEmployeesResponse,
  OrgAllEmployeeStats,
  PeopleTabConfig,
  PeopleTabId,
} from '../interfaces/org-people.interface';

/** Org People page tabs in visible order (`all` is the default). */
export const PEOPLE_TABS: readonly PeopleTabConfig[] = [
  { id: 'all', label: 'All Employees', icon: 'fa-light fa-users', noun: 'all employees' },
  { id: 'board', label: 'Board', icon: 'fa-light fa-user-tie', noun: 'board members' },
  { id: 'committee', label: 'Committee', icon: 'fa-light fa-users-rectangle', noun: 'committee members' },
  { id: 'contacts', label: 'Key Contacts', icon: 'fa-light fa-address-card', noun: 'key contacts' },
  { id: 'contributors', label: 'Contributors', icon: 'fa-light fa-code', noun: 'contributors' },
  { id: 'events', label: 'Event Attendees', icon: 'fa-light fa-calendar', noun: 'event attendees' },
  { id: 'training', label: 'Trainees', icon: 'fa-light fa-graduation-cap', noun: 'trainees' },
] as const;

/** Default tab — URL drops `?tab=` when active to keep deep links clean. */
export const DEFAULT_PEOPLE_TAB_ID: PeopleTabId = 'all';

/** Derived from PEOPLE_TABS; used to validate `?tab=` query-param input. */
export const VALID_PEOPLE_TAB_IDS: ReadonlySet<PeopleTabId> = new Set(PEOPLE_TABS.map((t) => t.id));

/** Initial visible-row cap on the All Employees table before "Show All" is clicked. */
export const ORG_ALL_EMPLOYEES_INITIAL_LIMIT = 30;

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
