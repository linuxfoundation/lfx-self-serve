// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import type { FormationPerson } from '../interfaces/formation-people.interface';
import {
  buildFormationPeople,
  countAssignedFormationItems,
  formatFormationPersonSubtitle,
  formationPersonKey,
  groupFormationPeople,
  isLfStaffEmail,
  resolveFormationPersonStatus,
  toFormationPersonRow,
} from './formation-people.utils';

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
  assigned_item_count: 0,
  ...overrides,
});

describe('isLfStaffEmail', () => {
  it('matches the LF domain case-insensitively', () => {
    expect(isLfStaffEmail('alex.rivera@linuxfoundation.org')).toBe(true);
    expect(isLfStaffEmail('Alex.Rivera@LinuxFoundation.ORG')).toBe(true);
  });

  it('rejects lookalike domains, subdomains, and malformed values', () => {
    expect(isLfStaffEmail('x@linuxfoundation.org.example')).toBe(false);
    expect(isLfStaffEmail('x@mail.linuxfoundation.org')).toBe(false);
    expect(isLfStaffEmail('x@notlinuxfoundation.org')).toBe(false);
    expect(isLfStaffEmail('linuxfoundation.org')).toBe(false);
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
    const people = buildFormationPeople(
      {
        writers: [{ name: 'Alex Rivera', email: 'Alex.Rivera@LinuxFoundation.org', username: 'alex.rivera', avatar: 'https://cdn.example/a.png' }],
        auditors: [{ name: 'Sam Chen', email: 'sam.chen@cascade-data.example', username: 'sam.chen' }],
      },
      []
    );

    expect(people).toEqual([
      expect.objectContaining({ key: 'alex.rivera', role: 'manage', group: 'staff', is_pending: false, avatar: 'https://cdn.example/a.png' }),
      expect.objectContaining({ key: 'sam.chen', role: 'view', group: 'invited', is_pending: false, avatar: null }),
    ]);
  });

  it('marks an email-only entry as pending with no assigned items', () => {
    const [pending] = buildFormationPeople({ writers: [], auditors: [{ name: 'Jordan Lee', email: 'Jordan.Lee@partner-corp.example' }] }, ['jordan.lee']);

    expect(pending).toEqual(
      expect.objectContaining({
        key: 'jordan.lee@partner-corp.example',
        username: null,
        email: 'Jordan.Lee@partner-corp.example',
        is_pending: true,
        group: 'invited',
        assigned_item_count: 0,
      })
    );
  });

  it('collapses a person listed as both writer and auditor to one manage row', () => {
    const people = buildFormationPeople(
      {
        writers: [{ name: 'Sam Chen', email: 'sam.chen@cascade-data.example', username: 'sam.chen' }],
        auditors: [{ name: 'Sam Chen', email: 'sam.chen@cascade-data.example', username: 'sam.chen' }],
      },
      ['sam.chen', 'sam.chen']
    );

    expect(people).toHaveLength(1);
    expect(people[0]).toEqual(expect.objectContaining({ role: 'manage', assigned_item_count: 2 }));
  });

  it('drops entries with neither username nor email and tolerates missing arrays', () => {
    expect(buildFormationPeople({ writers: [{ name: 'Ghost', email: '' }], auditors: undefined as never }, [])).toEqual([]);
  });

  it('falls back to the email as the display name and starts enrichment fields null', () => {
    const [row] = buildFormationPeople({ writers: [], auditors: [{ name: '  ', email: 'no.name@partner-corp.example', username: 'no.name' }] }, []);

    expect(row.name).toBe('no.name@partner-corp.example');
    expect(row.job_title).toBeNull();
    expect(row.organization).toBeNull();
  });

  it('sorts by name case-insensitively', () => {
    const people = buildFormationPeople(
      {
        writers: [
          { name: 'zoe', email: 'zoe@partner-corp.example', username: 'zoe' },
          { name: 'Adam', email: 'adam@partner-corp.example', username: 'adam' },
          { name: 'bea', email: 'bea@partner-corp.example', username: 'bea' },
        ],
        auditors: [],
      },
      []
    );

    expect(people.map((p) => p.name)).toEqual(['Adam', 'bea', 'zoe']);
  });
});

describe('groupFormationPeople', () => {
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
    expect(formatFormationPersonSubtitle(person({ job_title: 'Partner contact', organization: 'Cascade Data' }))).toBe('Partner contact · Cascade Data');
  });

  it('renders whichever of title or organization is present', () => {
    expect(formatFormationPersonSubtitle(person({ job_title: 'Legal' }))).toBe('Legal');
    expect(formatFormationPersonSubtitle(person({ organization: 'Cascade Data' }))).toBe('Cascade Data');
    expect(formatFormationPersonSubtitle(person({ job_title: '   ', organization: 'Cascade Data' }))).toBe('Cascade Data');
  });

  it('falls back to the email when nothing is known', () => {
    expect(formatFormationPersonSubtitle(person())).toBe('sam.chen@cascade-data.example');
  });

  it('appends a singular or plural item count only when non-zero', () => {
    expect(formatFormationPersonSubtitle(person({ job_title: 'Legal', assigned_item_count: 1 }))).toBe('Legal · 1 item');
    expect(formatFormationPersonSubtitle(person({ assigned_item_count: 3 }))).toBe('sam.chen@cascade-data.example · 3 items');
    expect(formatFormationPersonSubtitle(person({ job_title: 'Legal', assigned_item_count: 0 }))).toBe('Legal');
  });
});

describe('toFormationPersonRow', () => {
  it('carries the person through with the resolved subtitle and status', () => {
    const row = toFormationPersonRow(person({ is_pending: true, assigned_item_count: 0 }));

    expect(row).toEqual(expect.objectContaining({ key: 'sam.chen', subtitle: 'sam.chen@cascade-data.example', status: 'invite_sent' }));
  });
});
