// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Stubs for the admin Terms tab writes (linuxfoundation/lfx-mentorship#239): a stateful terms read plus the close,
 * re-open and delete writes. The stub keeps the terms in memory and applies each accepted write, so the read that
 * follows shows the change. All data is synthetic.
 */

import { MentorshipAdminTermsResponse, MentorshipProgramTermRow } from '@lfx-one/shared/interfaces';
import { Page, Route } from '@playwright/test';

import { ADMIN_PROGRAM_ID, adminTermId } from './mentorship-admin-program.helper';

const TERMS_ROUTE = `**/api/mentorship/admin/programs/${ADMIN_PROGRAM_ID}/terms*`;

const baseTerm = (n: number, overrides: Partial<MentorshipProgramTermRow>): MentorshipProgramTermRow => ({
  id: adminTermId(n),
  name: `Test Term ${n}`,
  status: 'open',
  pending: 0,
  declined: 0,
  accepted: 0,
  graduated: 0,
  startDate: '2099-09-01',
  endDate: '2099-12-01',
  applicationStartDate: '2099-06-01',
  applicationEndDate: '2099-08-01',
  ...overrides,
});

/** An open term with no accepted applications (Close), an open term with accepted ones, a closed one and an empty one. */
export const TERM_CLOSABLE_ID = adminTermId(1);
export const TERM_ACCEPTED_ID = adminTermId(2);
export const TERM_CLOSED_ID = adminTermId(3);
export const TERM_EMPTY_ID = adminTermId(4);

export const newTermRows = (): MentorshipProgramTermRow[] => [
  baseTerm(1, { pending: 2 }),
  baseTerm(2, { accepted: 3 }),
  baseTerm(3, { status: 'closed', graduated: 1 }),
  baseTerm(4, { status: 'closed' }),
];

export interface TermWriteRecord {
  method: string;
  path: string;
}

export interface TermStubState {
  terms: MentorshipProgramTermRow[];
  /** Every write received, in order. */
  writes: TermWriteRecord[];
}

export const newTermStubState = (terms: MentorshipProgramTermRow[] = newTermRows()): TermStubState => ({ terms, writes: [] });

const fulfillJson = (route: Route, status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

/** Answers the terms read from `state.terms`, and each write with `writeStatus` (204 applies the change). */
export async function stubTermActions(page: Page, state: TermStubState, writeStatus = 204): Promise<void> {
  await page.route(TERMS_ROUTE, (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === 'GET') {
      return fulfillJson(route, 200, { data: state.terms, total: state.terms.length } satisfies MentorshipAdminTermsResponse);
    }

    state.writes.push({ method: request.method(), path });
    if (writeStatus !== 204) return fulfillJson(route, writeStatus, { message: 'Stubbed server reason.' });

    const [termId, action] = path.split('/terms/')[1]?.split('/') ?? [];
    if (request.method() === 'DELETE') state.terms = state.terms.filter((term) => term.id !== termId);
    if (action === 'close' || action === 'reopen') {
      state.terms = state.terms.map((term) => (term.id === termId ? { ...term, status: action === 'close' ? 'closed' : 'open' } : term));
    }
    return route.fulfill({ status: 204 });
  });
}
