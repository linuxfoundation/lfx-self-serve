// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Stubs for the admin program page (linuxfoundation/lfx-mentorship#233): the page read, the server-paged
 * mentees read and the per-application tasks read, with synthetic data only. Each stub records the requests
 * it answered, so a spec can assert what the page asked for and, as importantly, what it did not.
 */

import {
  MentorshipAdminMenteesResponse,
  MentorshipAdminMentorsResponse,
  MentorshipAdminProgramPage,
  MentorshipAdminTermsResponse,
  MentorshipApplicantTask,
  MentorshipMenteeStatus,
  MentorshipProgramApplicant,
  MentorshipProgramMentor,
  MentorshipProgramTermRow,
} from '@lfx-one/shared/interfaces';
import { Page, Route } from '@playwright/test';

export const ADMIN_PROGRAM_ID = '61111111-1111-4111-8111-111111111111';
export const ADMIN_PROGRAM_URL = `/mentorship/admin/${ADMIN_PROGRAM_ID}`;
export const ADMIN_OPEN_TERM_ID = '66666666-6666-4666-8666-666666666666';
export const ADMIN_OPEN_TERM_NAME = 'Test Term Open';
export const ADMIN_MENTEES_TOTAL = 37;
export const ADMIN_MENTEES_PAGE_SIZE = 10;

const PROGRAM_ROUTE = `**/api/mentorship/admin/programs/${ADMIN_PROGRAM_ID}`;
const MENTEES_ROUTE = `**/api/mentorship/admin/programs/${ADMIN_PROGRAM_ID}/mentees*`;
const MENTORS_ROUTE = `**/api/mentorship/admin/programs/${ADMIN_PROGRAM_ID}/mentors*`;
const TERMS_ROUTE = `**/api/mentorship/admin/programs/${ADMIN_PROGRAM_ID}/terms*`;
const TASKS_ROUTE = '**/api/mentorship/admin/applications/*/tasks';

/** The id of the n-th synthetic application, from 1. */
export const adminApplicationId = (n: number): string => `7${String(n).padStart(7, '0')}-7777-4777-8777-777777777777`;

export const ADMIN_PROGRAM_PAGE: MentorshipAdminProgramPage = {
  program: {
    id: ADMIN_PROGRAM_ID,
    slug: 'test-program-admin',
    name: 'Test Program Admin',
    projectName: 'Test Project',
    term: ADMIN_OPEN_TERM_NAME,
    status: 'open',
    stats: { mentors: 0, mentees: 1, graduated: 1 },
    createdOn: '2026-06-01',
    updatedOn: '2026-07-20',
  },
  tabCounts: { currentMentees: ADMIN_MENTEES_TOTAL, pastMentees: 4, mentors: 0, terms: 2 },
  terms: [
    { id: ADMIN_OPEN_TERM_ID, name: ADMIN_OPEN_TERM_NAME, status: 'open' },
    { id: '67777777-7777-4777-8777-777777777777', name: 'Test Term Closed', status: 'closed' },
  ],
};

export const ADMIN_TASKS: MentorshipApplicantTask[] = [
  {
    id: 'tsk-1',
    name: 'Test Resume Task',
    description: 'Upload a synthetic resume.',
    status: 'submitted',
    prerequisite: false,
    createdOn: '2026-07-01',
    updatedOn: '2026-07-10',
    hasSubmission: true,
  },
];

/** Every mentee is `pending` except each third one, which is `accepted`, so a status filter has something to narrow. */
const ADMIN_APPLICATIONS: MentorshipProgramApplicant[] = Array.from({ length: ADMIN_MENTEES_TOTAL }, (_, index) => {
  const n = index + 1;
  return {
    id: adminApplicationId(n),
    name: `Test Applicant ${String(n).padStart(2, '0')}`,
    email: `test.applicant.${n}@example.com`,
    status: (n % 3 === 0 ? 'accepted' : 'pending') as MentorshipMenteeStatus,
    termId: ADMIN_OPEN_TERM_ID,
    termName: ADMIN_OPEN_TERM_NAME,
    createdOn: '2026-07-10',
    updatedOn: '2026-07-20',
    tasksSubmitted: 1,
    tasksTotal: 2,
  };
});

/** The closed-term applications the Past Mentees tab reads (`type=past`). */
export const ADMIN_PAST_APPLICATIONS: MentorshipProgramApplicant[] = [
  { name: 'Test Graduate One', status: 'graduated' },
  { name: 'Test Declined Two', status: 'declined' },
  { name: 'Test Withdrawn Three', status: 'withdrawn' },
].map(({ name, status }, index) => ({
  id: adminApplicationId(100 + index),
  name,
  email: `test.past.${index + 1}@example.com`,
  status: status as MentorshipMenteeStatus,
  termId: '67777777-7777-4777-8777-777777777777',
  termName: 'Test Term Closed',
  createdOn: '2026-01-10',
  updatedOn: '2026-05-02',
}));

/** One mentor per upstream status worth telling apart; ids are `adminMentorId(n)`. */
export const adminMentorId = (n: number): string => `8${String(n).padStart(7, '0')}-8888-4888-8888-888888888888`;

export const ADMIN_MENTORS: MentorshipProgramMentor[] = [
  { name: 'Test Mentor Active', status: 'active', profileCreated: true },
  { name: 'Test Mentor Invited', status: 'invited', profileCreated: false },
  { name: 'Test Mentor Declined', status: 'declined', profileCreated: false },
].map(({ name, status, profileCreated }, index) => ({
  id: adminMentorId(index + 1),
  name,
  email: `test.mentor.${index + 1}@example.com`,
  status: status as MentorshipProgramMentor['status'],
  invitedOn: '2026-03-04',
  profileCreated,
}));

export const adminTermId = (n: number): string => `9${String(n).padStart(7, '0')}-9999-4999-8999-999999999999`;

export const ADMIN_TERMS: MentorshipProgramTermRow[] = [
  {
    id: adminTermId(1),
    name: ADMIN_OPEN_TERM_NAME,
    status: 'open',
    pending: 3,
    declined: 1,
    accepted: 2,
    graduated: 0,
    startDate: '2099-09-01',
    endDate: '2099-12-01',
    applicationStartDate: '2099-06-01',
    applicationEndDate: '2099-08-01',
  },
  {
    id: adminTermId(2),
    name: 'Test Term Closed',
    status: 'closed',
    pending: 0,
    declined: 2,
    accepted: 0,
    graduated: 5,
    startDate: '2025-03-01',
    endDate: '2025-06-01',
    applicationStartDate: '2025-01-01',
    applicationEndDate: '2025-02-01',
  },
];

export interface AdminProgramRequests {
  /** Query strings of the mentees reads answered so far. */
  mentees: URLSearchParams[];
  /** Application ids of the tasks reads answered so far. */
  tasks: string[];
}

const fulfillJson = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

export async function stubAdminProgramPage(page: Page, body: MentorshipAdminProgramPage = ADMIN_PROGRAM_PAGE): Promise<void> {
  await page.route(PROGRAM_ROUTE, (route) => fulfillJson(route, body));
}

/** Answers the page read with an error status instead of a page. */
export async function stubAdminProgramPageError(page: Page, status: number): Promise<void> {
  await page.route(PROGRAM_ROUTE, (route) => fulfillJson(route, { error: 'stubbed' }, status));
}

/**
 * Answers the mentees read from the 37 synthetic applications, honoring `offset`, `limit`, `status` and `search`.
 * Pass `failWith` to answer every read with that error status instead.
 */
export async function stubAdminMentees(page: Page, requests: AdminProgramRequests, failWith?: number): Promise<void> {
  await page.route(MENTEES_ROUTE, (route) => {
    const params = new URL(route.request().url()).searchParams;
    requests.mentees.push(params);
    if (failWith) return fulfillJson(route, { error: 'stubbed' }, failWith);

    const status = params.get('status');
    const search = params.get('search')?.toLowerCase();
    const source = params.get('type') === 'past' ? ADMIN_PAST_APPLICATIONS : ADMIN_APPLICATIONS;
    const matching = source.filter((application) => (!status || application.status === status) && (!search || application.name.toLowerCase().includes(search)));
    const offset = Number(params.get('offset') ?? 0);
    const limit = Number(params.get('limit') ?? ADMIN_MENTEES_PAGE_SIZE);
    return fulfillJson(route, { data: matching.slice(offset, offset + limit), total: matching.length } satisfies MentorshipAdminMenteesResponse);
  });
}

/** Answers the mentors read from the synthetic mentors, honoring `status`; `failWith` answers every read with that error status. */
export async function stubAdminMentors(page: Page, requests: URLSearchParams[], failWith?: number): Promise<void> {
  await page.route(MENTORS_ROUTE, (route) => {
    const params = new URL(route.request().url()).searchParams;
    requests.push(params);
    if (failWith) return fulfillJson(route, { error: 'stubbed' }, failWith);

    const status = params.get('status');
    const search = params.get('search')?.toLowerCase();
    const matching = ADMIN_MENTORS.filter((mentor) => (!status || mentor.status === status) && (!search || mentor.name.toLowerCase().includes(search)));
    return fulfillJson(route, { data: matching, total: matching.length } satisfies MentorshipAdminMentorsResponse);
  });
}

/** Answers the terms read with the synthetic terms; `failWith` answers every read with that error status. */
export async function stubAdminTerms(page: Page, requests: URLSearchParams[], failWith?: number): Promise<void> {
  await page.route(TERMS_ROUTE, (route) => {
    requests.push(new URL(route.request().url()).searchParams);
    if (failWith) return fulfillJson(route, { error: 'stubbed' }, failWith);
    return fulfillJson(route, { data: ADMIN_TERMS, total: ADMIN_TERMS.length } satisfies MentorshipAdminTermsResponse);
  });
}

/** Answers the tasks read, recording the application it was for; pass `failWith` to answer with that error status. */
export async function stubAdminTasks(page: Page, requests: AdminProgramRequests, failWith?: () => number | undefined): Promise<void> {
  await page.route(TASKS_ROUTE, (route) => {
    const applicationId = new URL(route.request().url()).pathname.split('/').slice(-2)[0];
    requests.tasks.push(applicationId);
    const status = failWith?.();
    if (status) return fulfillJson(route, { error: 'stubbed' }, status);
    return fulfillJson(route, ADMIN_TASKS);
  });
}
