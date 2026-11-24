// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Stubs for the admin program page's actions (linuxfoundation/lfx-mentorship#378): Hide/Unhide and View Public Page
 * in the header (#280, #385), the published statuses it covers (#426), Undo graduation and Re-open (#395), Contact
 * Mentee (#376), and Download By Status (#296). Data is synthetic, and the stubs record what the page sent (each
 * write's method, path and body, each export's query, how many times the program was read), so a spec can assert
 * what the page sent as well as what it rendered.
 */

import {
  MentorshipAdminMenteesResponse,
  MentorshipAdminProgramPage,
  MentorshipMenteeStatus,
  MentorshipProgramApplicant,
  MentorshipProgramStatus,
  MentorshipProgramVisibilityAction,
} from '@lfx-one/shared/interfaces';
import { Page, Route } from '@playwright/test';

import {
  ADMIN_OPEN_TERM_ID,
  ADMIN_OPEN_TERM_NAME,
  ADMIN_PAST_APPLICATIONS,
  ADMIN_MENTEES_ROUTE,
  ADMIN_PROGRAM_ID,
  ADMIN_PROGRAM_PAGE,
  ADMIN_PROGRAM_ROUTE,
  adminApplicationId,
  fulfillAdminJson,
} from './mentorship-admin-program.helper';

const EXPORT_ROUTE = `**/api/mentorship/admin/programs/${ADMIN_PROGRAM_ID}/mentees/export*`;
const STATUS_ROUTE = '**/api/mentorship/admin/applications/*/status';

/** The statuses a Current Mentees row can have, one row each, in this order. */
export const ACTION_ROW_STATUSES: readonly MentorshipMenteeStatus[] = ['pending', 'accepted', 'declined', 'withdrawn', 'graduated'];

/** The id of the Current Mentees row with `status`. */
export const actionRowId = (status: MentorshipMenteeStatus): string => adminApplicationId(200 + ACTION_ROW_STATUSES.indexOf(status));

/** A pending row whose address would inject a recipient into a `mailto:` link, so it offers no Contact Mentee. */
export const ACTION_NO_EMAIL_ID = adminApplicationId(299);

export const ACTION_ROWS: MentorshipProgramApplicant[] = [
  ...ACTION_ROW_STATUSES.map((status) => ({
    id: actionRowId(status),
    name: `Test Mentee ${status[0].toUpperCase()}${status.slice(1)}`,
    email: `test.mentee.${status}@example.com`,
    status,
    termId: ADMIN_OPEN_TERM_ID,
    termName: ADMIN_OPEN_TERM_NAME,
    createdOn: '2026-07-10',
    updatedOn: '2026-07-20',
    tasksSubmitted: 2,
    tasksTotal: 2,
  })),
  {
    id: ACTION_NO_EMAIL_ID,
    name: 'Test Mentee No Address',
    email: 'test.mentee.no-address@example.com?bcc=test.other@example.com',
    status: 'pending',
    termId: ADMIN_OPEN_TERM_ID,
    termName: ADMIN_OPEN_TERM_NAME,
    createdOn: '2026-07-10',
    updatedOn: '2026-07-20',
    tasksSubmitted: 0,
    tasksTotal: 2,
  },
];

/** The email of the row with `id`. */
export const actionRowEmail = (id: string): string => ACTION_ROWS.find((row) => row.id === id)?.email ?? '';

/** What the program page stubs read and record. `status` is read on every page read, so a write can change it. */
export interface ActionState {
  status: MentorshipProgramStatus;
  /** How many times the page was read. */
  pageReads: number;
  /** Every write the page sent, as `METHOD /path` and its JSON body. */
  writes: { method: string; path: string; body: unknown }[];
  /** Query strings of the export reads answered so far. */
  exports: URLSearchParams[];
}

export const newActionState = (status: MentorshipProgramStatus): ActionState => ({ status, pageReads: 0, writes: [], exports: [] });

function recordWrite(state: ActionState, route: Route): void {
  const request = route.request();
  state.writes.push({ method: request.method(), path: new URL(request.url()).pathname, body: request.postDataJSON() });
}

/** Answers the page read with the program in `state.status`, and the mentees reads with `ACTION_ROWS` (Past Mentees: the past rows). */
export async function stubActionProgram(page: Page, state: ActionState): Promise<void> {
  await page.route(ADMIN_PROGRAM_ROUTE, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    state.pageReads++;
    const body: MentorshipAdminProgramPage = {
      ...ADMIN_PROGRAM_PAGE,
      program: { ...ADMIN_PROGRAM_PAGE.program, status: state.status },
      tabCounts: { currentMentees: ACTION_ROWS.length, pastMentees: ADMIN_PAST_APPLICATIONS.length, mentors: 0, terms: 2 },
    };
    return fulfillAdminJson(route, body);
  });
  await page.route(ADMIN_MENTEES_ROUTE, (route) => {
    const params = new URL(route.request().url()).searchParams;
    const rows = params.get('type') === 'past' ? ADMIN_PAST_APPLICATIONS : ACTION_ROWS;
    return fulfillAdminJson(route, { data: rows, total: rows.length } satisfies MentorshipAdminMenteesResponse);
  });
}

/**
 * Answers Hide and Unhide with `status` (204 by default). A write that succeeds moves `state.status` the way upstream
 * would, so the page's next read shows the program hidden, or published again.
 */
export async function stubVisibilityWrites(page: Page, state: ActionState, status = 204): Promise<void> {
  for (const action of ['hide', 'unhide'] satisfies MentorshipProgramVisibilityAction[]) {
    await page.route(`**/api/mentorship/admin/programs/${ADMIN_PROGRAM_ID}/${action}`, (route) => {
      recordWrite(state, route);
      if (status !== 204) return fulfillAdminJson(route, { error: 'stubbed' }, status);
      state.status = action === 'hide' ? 'hidden' : 'accepting';
      return route.fulfill({ status });
    });
  }
}

/** Answers every application status change with `status` (204 by default). */
export async function stubStatusWrites(page: Page, state: ActionState, status = 204): Promise<void> {
  await page.route(STATUS_ROUTE, (route) => {
    recordWrite(state, route);
    return status === 204 ? route.fulfill({ status }) : fulfillAdminJson(route, { error: 'stubbed' }, status);
  });
}

export interface ExportAnswer {
  /** 200 by default; 204 means no mentee matched. */
  status?: number;
  /** Set as `X-Export-Truncated`, as the BFF does when the file stopped at its page cap. */
  truncatedAt?: number;
  /** Holds the answer until it resolves, so a spec can look at the page while the download is in flight. */
  hold?: Promise<void>;
}

/** Answers the CSV export with a synthetic file named as the BFF names it, `<tab>-mentees-<status or all>.csv`. */
export async function stubMenteesExport(page: Page, state: ActionState, answer: ExportAnswer = {}): Promise<void> {
  await page.route(EXPORT_ROUTE, async (route) => {
    const params = new URL(route.request().url()).searchParams;
    state.exports.push(params);
    await answer.hold;
    const status = answer.status ?? 200;
    if (status === 204) return route.fulfill({ status });
    if (status !== 200) return fulfillAdminJson(route, { error: 'stubbed' }, status);

    const fileName = `${params.get('type')}-mentees-${params.get('status') ?? 'all'}.csv`;
    const headers: Record<string, string> = { 'Content-Disposition': `attachment; filename="${fileName}"` };
    if (answer.truncatedAt !== undefined) headers['X-Export-Truncated'] = String(answer.truncatedAt);
    return route.fulfill({ status, headers, contentType: 'text/csv', body: 'Name,Email\nTest Mentee,test.mentee@example.com\n' });
  });
}
