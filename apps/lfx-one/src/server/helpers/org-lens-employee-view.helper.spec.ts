// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import type { OrgLensEmployeeViewException } from '@lfx-one/shared/interfaces';
import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getOrgLensViewMode: vi.fn() }));
vi.mock('./org-lens-read-access.helper', () => ({ getOrgLensViewMode: mocks.getOrgLensViewMode }));

const { redactForEmployeeView, scrubFreeText, stripPersonalFields } = await import('./org-lens-employee-view.helper');

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

describe('embedded personal data in free text', () => {
  it('removes an email inside a sentence', () => {
    expect(stripPersonalFields({ message: 'Fix bug\n\nSigned-off-by: Ada <ada@acme.example>' }, page)).toEqual({
      message: 'Fix bug\n\nSigned-off-by: Ada <>',
    });
    expect(stripPersonalFields({ note: 'contact ada@acme.example for access' }, page)).toEqual({ note: 'contact  for access' });
  });

  it('keeps git remotes and version specs, which only look like addresses', () => {
    expect(scrubFreeText('clone git@git.example.com:acme-org/repo.git then pin pkg@1.2.3')).toBe(
      'clone git@git.example.com:acme-org/repo.git then pin pkg@1.2.3'
    );
    expect(scrubFreeText('contact ada@acme.example, thanks')).toBe('contact , thanks');
  });

  it('keeps whole-value git remotes and version specs through stripPersonalFields', () => {
    const input = {
      remote: 'git@git.example.com:acme-org/repo.git',
      pin: 'pkg@1.2.3',
      list: ['git@git.example.com:acme-org/repo.git', 'ada@example.com'],
      owner: 'ada@example.com',
    };
    expect(stripPersonalFields(input, { page: 'projects' })).toEqual({ remote: input.remote, pin: input.pin, list: [input.remote] });
  });

  it('removes addresses on punycode and non-ASCII top-level domains', () => {
    // Built at runtime: the fixture-domain check only knows ASCII reserved domains, and these TLDs are the point of the test.
    const punycode = ['ada', 'acme.xn--p1ai'].join('@');
    const unicode = ['ada', 'acme.рф'].join('@');
    expect(stripPersonalFields({ owner: punycode, list: [punycode, unicode] }, page)).toEqual({ list: [] });
    expect(scrubFreeText(`write ${punycode} or ${unicode} today`)).toBe('write  or  today');
    expect(scrubFreeText('pin pkg@1.2.3 and git@git.example.com:acme-org/repo.git')).toBe('pin pkg@1.2.3 and git@git.example.com:acme-org/repo.git');
  });

  it('does not swallow unspaced CJK text next to an address', () => {
    expect(scrubFreeText('联系ada@example.com')).toBe('联系');
    expect(stripPersonalFields({ note: '联系ada@example.com 谢谢' }, page)).toEqual({ note: '联系 谢谢' });
  });

  it('removes embedded emails in nested objects and arrays', () => {
    const input = { rows: [{ detail: { text: 'ping bob@team.example now' } }], tags: ['ok', 'see carol@team.example', 'dan@team.example'] };

    expect(stripPersonalFields(input, page)).toEqual({ rows: [{ detail: { text: 'ping  now' } }], tags: ['ok', 'see '] });
  });

  it('removes mailto links and personal profile URLs but keeps ordinary URLs', () => {
    expect(scrubFreeText('mail mailto:ada@acme.example or https://www.linkedin.com/in/ada-lovelace today')).toBe('mail  or  today');
    expect(scrubFreeText('see https://github.com/kubernetes/kubernetes and https://acme.example/about')).toBe(
      'see https://github.com/kubernetes/kubernetes and https://acme.example/about'
    );
  });

  it('leaves text with no personal data and non-string values alone', () => {
    expect(stripPersonalFields({ text: 'plain text', n: 4, ok: true, none: null }, page)).toEqual({ text: 'plain text', n: 4, ok: true, none: null });
  });

  it('keeps an excepted field exactly as supplied', () => {
    const exceptions: OrgLensEmployeeViewException[] = [{ page: 'projects', field: 'note', reason: 'public', approvedBy: 'product owner' }];

    expect(stripPersonalFields({ note: 'a@b.example here' }, { page: 'projects', exceptions })).toEqual({ note: 'a@b.example here' });
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
