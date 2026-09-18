// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FormationPeopleResponse, FormationPerson } from '@lfx-one/shared/interfaces';

/**
 * Mock `GET /api/projects/:slug/formation/people` data for Playwright tests (#2724). One LF staff
 * row (the product's own domain — the only non-`.example` address, and the one the grouping keys
 * on), one accepted partner, and one pending invite; `alex.rivera`/`sam.chen` mirror the item
 * owners in `formation-item.mock.ts` so the assigned-item counts line up with the checklist.
 */
export const mockFormationPeople: FormationPerson[] = [
  {
    key: 'alex.rivera',
    username: 'alex.rivera',
    name: 'Alex Rivera',
    email: 'alex.rivera@linuxfoundation.org',
    role: 'manage',
    group: 'staff',
    is_pending: false,
    job_title: 'Program Manager',
    organization: null,
    avatar: null,
    assigned_item_count: 1,
  },
  {
    key: 'sam.chen',
    username: 'sam.chen',
    name: 'Sam Chen',
    email: 'sam.chen@cascade-data.example',
    role: 'view',
    group: 'invited',
    is_pending: false,
    job_title: 'Partner contact',
    organization: 'Cascade Data',
    avatar: null,
    assigned_item_count: 1,
  },
  {
    key: 'jordan.lee@partner-corp.example',
    username: null,
    name: 'Jordan Lee',
    email: 'jordan.lee@partner-corp.example',
    role: 'view',
    group: 'invited',
    is_pending: true,
    job_title: null,
    organization: null,
    avatar: null,
    assigned_item_count: 0,
  },
];

export const mockFormationPeopleResponse: FormationPeopleResponse = { state: 'loaded', people: mockFormationPeople };
