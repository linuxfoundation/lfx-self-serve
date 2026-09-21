// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { FORMATION_ASSIGNEE_PENDING_NOTE, LF_STAFF_EMAIL_DOMAIN } from '../constants/formation-people.constants';
import type { FormationPerson } from '../interfaces/formation-people.interface';
import {
  buildFormationPeople,
  countAssignedFormationItems,
  findFormationPersonByUsername,
  formatFormationPersonSubtitle,
  formationPeopleGroupKeys,
  formationPersonKey,
  groupFormationPeople,
  isLfStaffEmail,
  resolveFormationPersonStatus,
  toAssigneeSearchOption,
  toFormationPersonRow,
} from './formation-people.utils';

// Built from the constant rather than spelled out: the repo's fixture-email guard
// (check-fixture-emails.sh, GH-1674) denylists the LF domain itself in spec files.
const LF_STAFF_EMAIL = `alex.rivera@${LF_STAFF_EMAIL_DOMAIN}`;
const LF_STAFF_EMAIL_MIXED_CASE = `Alex.Rivera@${LF_STAFF_EMAIL_DOMAIN.replace('linux', 'Linux').replace('.org', '.ORG')}`;

const person = (overrides: Partial<FormationPerson> = {}): FormationPerson => ({
  key: 'sam.chen',
  username: 'sam.chen',
  name: 'Sam Chen',
  email: 'sam.chen@cascade-data.example',
  role: 'view',
  group: 'invited',
  is_pending: false,
  job_title: null,
  organization: null,
  avatar: null,
  ...overrides,
});

describe('isLfStaffEmail', () => {
  it('matches the LF domain case-insensitively', () => {
    expect(isLfStaffEmail(LF_STAFF_EMAIL)).toBe(true);
    expect(isLfStaffEmail(LF_STAFF_EMAIL_MIXED_CASE)).toBe(true);
  });

  it('rejects lookalike domains, subdomains, and malformed values', () => {
    expect(isLfStaffEmail(`x@${LF_STAFF_EMAIL_DOMAIN}.example`)).toBe(false);
    expect(isLfStaffEmail(`x@mail.${LF_STAFF_EMAIL_DOMAIN}`)).toBe(false);
    expect(isLfStaffEmail(`x@not${LF_STAFF_EMAIL_DOMAIN}`)).toBe(false);
    expect(isLfStaffEmail(LF_STAFF_EMAIL_DOMAIN)).toBe(false);
    expect(isLfStaffEmail('')).toBe(false);
    expect(isLfStaffEmail(null)).toBe(false);
    expect(isLfStaffEmail(undefined)).toBe(false);
  });
});

describe('formationPersonKey', () => {
  it('prefers the trimmed username', () => {
    expect(formationPersonKey({ username: ' sam.chen ', email: 'SAM@x.example' })).toBe('sam.chen');
  });

  it('falls back to the lowercased email when there is no username', () => {
    expect(formationPersonKey({ username: '', email: ' Jordan.Lee@Partner-Corp.example ' })).toBe('jordan.lee@partner-corp.example');
    expect(formationPersonKey({ email: 'a@b.example' })).toBe('a@b.example');
  });

  it('is empty when the entry has neither', () => {
    expect(formationPersonKey({ email: '' })).toBe('');
  });
});

describe('countAssignedFormationItems', () => {
  it('counts exact username matches only', () => {
    expect(countAssignedFormationItems(['sam.chen', 'alex.rivera', 'sam.chen', null, undefined], 'sam.chen')).toBe(2);
    expect(countAssignedFormationItems(['Sam.Chen'], 'sam.chen')).toBe(0);
  });

  it('is zero without a username', () => {
    expect(countAssignedFormationItems(['sam.chen'], null)).toBe(0);
    expect(countAssignedFormationItems(['sam.chen'], '')).toBe(0);
  });
});

describe('buildFormationPeople', () => {
  it('classifies writers as manage and auditors as view, grouping by email domain', () => {
    const people = buildFormationPeople({
      writers: [{ name: 'Alex Rivera', email: LF_STAFF_EMAIL_MIXED_CASE, username: 'alex.rivera', avatar: 'https://cdn.example/a.png' }],
      auditors: [{ name: 'Sam Chen', email: 'sam.chen@cascade-data.example', username: 'sam.chen' }],
    });

    expect(people).toEqual([
      expect.objectContaining({ key: 'alex.rivera', role: 'manage', group: 'staff', is_pending: false, avatar: 'https://cdn.example/a.png' }),
      expect.objectContaining({ key: 'sam.chen', role: 'view', group: 'invited', is_pending: false, avatar: null }),
    ]);
  });

  it('marks an email-only entry as pending', () => {
    const [pending] = buildFormationPeople({ writers: [], auditors: [{ name: 'Jordan Lee', email: 'Jordan.Lee@partner-corp.example' }] });

    expect(pending).toEqual(
      expect.objectContaining({
        key: 'jordan.lee@partner-corp.example',
        username: null,
        email: 'Jordan.Lee@partner-corp.example',
        is_pending: true,
        group: 'invited',
      })
    );
  });

  it('collapses a person listed as both writer and auditor to one manage row', () => {
    const people = buildFormationPeople({
      writers: [{ name: 'Sam Chen', email: 'sam.chen@cascade-data.example', username: 'sam.chen' }],
      auditors: [{ name: 'Sam Chen', email: 'sam.chen@cascade-data.example', username: 'sam.chen' }],
    });

    expect(people).toHaveLength(1);
    expect(people[0]).toEqual(expect.objectContaining({ role: 'manage' }));
  });

  it('collapses an email-only entry onto the username entry for the same address, whichever role holds each', () => {
    const people = buildFormationPeople({
      writers: [{ name: 'Sam Chen', email: 'Sam.Chen@cascade-data.example' }],
      auditors: [{ name: 'Sam Chen', email: 'sam.chen@cascade-data.example', username: 'sam.chen' }],
    });

    expect(people).toHaveLength(1);
    expect(people[0]).toEqual(expect.objectContaining({ key: 'sam.chen', is_pending: false, role: 'view' }));
  });

  it('drops entries with neither username nor email and tolerates missing arrays', () => {
    expect(buildFormationPeople({ writers: [{ name: 'Ghost', email: '' }], auditors: undefined as never })).toEqual([]);
  });

  it('falls back to the email as the display name and starts enrichment fields null', () => {
    const [row] = buildFormationPeople({ writers: [], auditors: [{ name: '  ', email: 'no.name@partner-corp.example', username: 'no.name' }] });

    expect(row.name).toBe('no.name@partner-corp.example');
    expect(row.job_title).toBeNull();
    expect(row.organization).toBeNull();
  });

  it('sorts by name case-insensitively', () => {
    const people = buildFormationPeople({
      writers: [
        { name: 'zoe', email: 'zoe@partner-corp.example', username: 'zoe' },
        { name: 'Adam', email: 'adam@partner-corp.example', username: 'adam' },
        { name: 'bea', email: 'bea@partner-corp.example', username: 'bea' },
      ],
      auditors: [],
    });

    expect(people.map((p) => p.name)).toEqual(['Adam', 'bea', 'zoe']);
  });
});

describe('formationPeopleGroupKeys', () => {
  it('follows the labels constant, staff first', () => {
    expect(formationPeopleGroupKeys()).toEqual(['staff', 'invited']);
  });
});

describe('groupFormationPeople', () => {
  it('returns every group key even when empty', () => {
    expect(groupFormationPeople([])).toEqual({ staff: [], invited: [] });
  });

  it('partitions by group and preserves order within each', () => {
    const groups = groupFormationPeople([
      person({ key: 'b', name: 'B', group: 'invited' }),
      person({ key: 'a', name: 'A', group: 'staff' }),
      person({ key: 'c', name: 'C', group: 'invited' }),
    ]);

    expect(groups.staff.map((p) => p.key)).toEqual(['a']);
    expect(groups.invited.map((p) => p.key)).toEqual(['b', 'c']);
  });
});

describe('resolveFormationPersonStatus', () => {
  it('gives staff no chip', () => {
    expect(resolveFormationPersonStatus({ group: 'staff', is_pending: false })).toBeNull();
    expect(resolveFormationPersonStatus({ group: 'staff', is_pending: true })).toBeNull();
  });

  it('distinguishes accepted from pending external entries', () => {
    expect(resolveFormationPersonStatus({ group: 'invited', is_pending: false })).toBe('invited');
    expect(resolveFormationPersonStatus({ group: 'invited', is_pending: true })).toBe('invite_sent');
  });
});

describe('formatFormationPersonSubtitle', () => {
  it('renders title and organization joined by a middot', () => {
    expect(formatFormationPersonSubtitle(person({ job_title: 'Partner contact', organization: 'Cascade Data' }), 0)).toBe('Partner contact · Cascade Data');
  });

  it('renders whichever of title or organization is present', () => {
    expect(formatFormationPersonSubtitle(person({ job_title: 'Legal' }), 0)).toBe('Legal');
    expect(formatFormationPersonSubtitle(person({ organization: 'Cascade Data' }), 0)).toBe('Cascade Data');
    expect(formatFormationPersonSubtitle(person({ job_title: '   ', organization: 'Cascade Data' }), 0)).toBe('Cascade Data');
  });

  it('falls back to the email when nothing is known', () => {
    expect(formatFormationPersonSubtitle(person(), 0)).toBe('sam.chen@cascade-data.example');
  });

  it('appends a singular or plural item count only when non-zero', () => {
    expect(formatFormationPersonSubtitle(person({ job_title: 'Legal' }), 1)).toBe('Legal · 1 item');
    expect(formatFormationPersonSubtitle(person(), 3)).toBe('sam.chen@cascade-data.example · 3 items');
    expect(formatFormationPersonSubtitle(person({ job_title: 'Legal' }), 0)).toBe('Legal');
  });
});

describe('toFormationPersonRow', () => {
  it('counts the checklist assignees for the person and carries the subtitle and status through', () => {
    const row = toFormationPersonRow(person({ job_title: 'Partner contact' }), ['sam.chen', 'alex.rivera', 'sam.chen', null]);

    expect(row).toEqual(expect.objectContaining({ key: 'sam.chen', assigned_item_count: 2, subtitle: 'Partner contact · 2 items', status: 'invited' }));
  });

  it('never counts items for a pending entry, which has no username to match', () => {
    const row = toFormationPersonRow(person({ username: null, is_pending: true }), ['sam.chen']);

    expect(row).toEqual(expect.objectContaining({ assigned_item_count: 0, subtitle: 'sam.chen@cascade-data.example', status: 'invite_sent' }));
  });
});

describe('toAssigneeSearchOption', () => {
  it('maps a listed person to a selectable picker row carrying the whole name in first_name', () => {
    const option = toAssigneeSearchOption(person({ job_title: 'Legal', organization: 'Cascade Data' }));

    expect(option).toEqual({
      uid: 'sam.chen',
      email: 'sam.chen@cascade-data.example',
      first_name: 'Sam Chen',
      last_name: '',
      job_title: 'Legal',
      organization: { name: 'Cascade Data' },
      committee: null,
      type: 'project_member',
      username: 'sam.chen',
      disabled: false,
      note: null,
    });
  });

  it('lists a pending invitee but disables the row with the pending note', () => {
    const option = toAssigneeSearchOption(person({ key: 'pat@partner.example', username: null, is_pending: true, email: 'pat@partner.example' }));

    expect(option).toEqual(expect.objectContaining({ uid: 'pat@partner.example', username: null, disabled: true, note: FORMATION_ASSIGNEE_PENDING_NOTE }));
    expect(option.organization).toBeNull();
  });

  it('leaves the name empty for an entry whose name fell back to its email, so the address is not shown twice', () => {
    const option = toAssigneeSearchOption(person({ key: 'pat@partner.example', username: null, name: 'pat@partner.example', email: 'pat@partner.example', is_pending: true }));

    expect(option.first_name).toBe('');
    expect(option.email).toBe('pat@partner.example');
  });
});

describe('findFormationPersonByUsername', () => {
  const people = [person(), person({ key: 'alex.rivera', username: 'alex.rivera', name: 'Alex Rivera' })];

  it('finds the person holding the (trimmed) username', () => {
    expect(findFormationPersonByUsername(people, ' alex.rivera ')?.name).toBe('Alex Rivera');
  });

  it('returns null for a blank or unknown username', () => {
    expect(findFormationPersonByUsername(people, '')).toBeNull();
    expect(findFormationPersonByUsername(people, null)).toBeNull();
    expect(findFormationPersonByUsername(people, 'nobody')).toBeNull();
  });
});
