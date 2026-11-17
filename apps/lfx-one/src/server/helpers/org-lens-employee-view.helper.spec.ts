// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import type { OrgLensEmployeeViewException } from '@lfx-one/shared/interfaces';
import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getOrgLensViewMode: vi.fn() }));
vi.mock('./org-lens-read-access.helper', () => ({ getOrgLensViewMode: mocks.getOrgLensViewMode }));

const { redactForEmployeeView, stripPersonalFields } = await import('./org-lens-employee-view.helper');

const page = { page: 'projects' };

describe('stripPersonalFields', () => {
  it('removes name and email fields at any depth, in objects and arrays, in any key casing', () => {
    const input = {
      total: 3,
      projectName: 'Kubernetes',
      rows: [{ id: 'a', firstName: 'Ada', last_name: 'Lovelace', Email: 'ada@acme.example', commits: 12 }],
      nested: { contacts: [{ displayName: 'Ada', emailAddress: 'ada@acme.example' }] },
    };

    expect(stripPersonalFields(input, page)).toEqual({
      total: 3,
      projectName: 'Kubernetes',
      rows: [{ id: 'a', commits: 12 }],
      nested: { contacts: [{}] },
    });
  });

  it('drops an email-shaped value that arrives under an unlisted key, and email strings in an array', () => {
    expect(stripPersonalFields({ owner: 'ada@acme.example', handles: ['ada@acme.example', 'ada-gh'] }, page)).toEqual({ handles: ['ada-gh'] });
  });

  it('keeps public technical data such as GitHub usernames and counts', () => {
    const input = { githubUsername: 'ada-lovelace', contributions: 40, repo: 'kubernetes/kubernetes' };

    expect(stripPersonalFields(input, page)).toEqual(input);
  });

  it('removes route-specific keys named in extraFields, and only there', () => {
    expect(stripPersonalFields({ name: 'Ada', projectName: 'K8s' }, { ...page, extraFields: ['name'] })).toEqual({ projectName: 'K8s' });
    expect(stripPersonalFields({ name: 'Ada' }, page)).toEqual({ name: 'Ada' });
  });

  it('never mutates its input and passes primitives, null and dates through', () => {
    const date = new Date('2026-01-01');
    const input = { email: 'user@example.com', date, none: null };

    expect(stripPersonalFields(input, page)).toEqual({ date, none: null });
    expect(input.email).toBe('user@example.com');
    expect(stripPersonalFields('text', page)).toBe('text');
    expect(stripPersonalFields(null, page)).toBeNull();
  });

  it('exposes nothing by default: the shipped exceptions allow-list is empty', async () => {
    const { ORG_LENS_EMPLOYEE_VIEW_EXCEPTIONS } = await import('@lfx-one/shared/constants');

    expect(ORG_LENS_EMPLOYEE_VIEW_EXCEPTIONS).toEqual([]);
  });

  it('keeps a field only for the page that has a reviewed exception for it', () => {
    const exceptions: OrgLensEmployeeViewException[] = [{ page: 'projects', field: 'email', reason: 'public maintainer address', approvedBy: 'product owner' }];
    const input = { email: 'maintainer@acme.example', firstName: 'Ada' };

    expect(stripPersonalFields(input, { page: 'projects', exceptions })).toEqual({ email: 'maintainer@acme.example' });
    expect(stripPersonalFields(input, { page: 'events', exceptions })).toEqual({});
  });
});

describe('redactForEmployeeView', () => {
  const req = {} as Request;

  it('strips in the employee view', () => {
    mocks.getOrgLensViewMode.mockReturnValue('employee');

    expect(redactForEmployeeView(req, 'org', { email: 'user@example.com', n: 1 }, page)).toEqual({ n: 1 });
  });

  it('returns the response untouched in the full view', () => {
    mocks.getOrgLensViewMode.mockReturnValue('full');
    const data = { email: 'user@example.com', n: 1 };

    expect(redactForEmployeeView(req, 'org', data, page)).toBe(data);
  });
});
