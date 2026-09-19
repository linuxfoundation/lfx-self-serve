// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { LF_STAFF_EMAIL_DOMAIN } from '@lfx-one/shared/constants';
import { FormationPeopleResponse, FormationPerson } from '@lfx-one/shared/interfaces';

/**
 * Mock `GET /api/projects/:slug/formation/people` data for Playwright tests (#2724). One LF staff
 * row (address built from `LF_STAFF_EMAIL_DOMAIN` — the grouping keys on it, and spelling the
 * domain out would trip check-fixture-emails.sh), one accepted partner, and one pending invite;
 * `alex.rivera`/`sam.chen` mirror the item owners in `formation-item.mock.ts`, which is where the
 * card takes each row's assigned-item count from (one item each there).
 */
export const mockFormationPeople: FormationPerson[] = [
  {
    key: 'alex.rivera',
    username: 'alex.rivera',
    name: 'Alex Rivera',
    email: `alex.rivera@${LF_STAFF_EMAIL_DOMAIN}`,
    role: 'manage',
    group: 'staff',
    is_pending: false,
    job_title: 'Program Manager',
    organization: null,
    avatar: null,
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
  },
];

export const mockFormationPeopleResponse: FormationPeopleResponse = { state: 'loaded', people: mockFormationPeople };
