// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { OrgTrainingStatsQuery } from '@lfx-one/shared/interfaces';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { OrgLensTrainingService } from './org-lens-training.service';

const QUERY: OrgTrainingStatsQuery = { range: '730d', foundation: null, project: null, course: 'C++ & Rust+1', level: null, format: null };

describe('OrgLensTrainingService', () => {
  let service: OrgLensTrainingService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(OrgLensTrainingService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('encodes a plus in a course name so it is not read as a space', () => {
    service.getTrainingStats('org-1', QUERY).subscribe();

    const request = http.expectOne((req) => req.url.endsWith('/stats'));
    expect(request.request.urlWithParams).toContain('course=C%2B%2B%20%26%20Rust%2B1');
    request.flush({});
  });

  it('encodes a plus in the group search, the group value and the filters of every call', () => {
    service.getGroups('org-1', QUERY, { groupBy: 'course', tab: 'trainings', searchQuery: 'a+b' }).subscribe();
    const groups = http.expectOne((req) => req.url.endsWith('/groups'));
    expect(groups.request.urlWithParams).toContain('search=a%2Bb');
    expect(groups.request.urlWithParams).toContain('course=C%2B%2B');
    groups.flush({});

    service.getGroupEmployees('org-1', QUERY, { groupBy: 'course', groupValue: 'C++', tab: 'trainings', status: 'completed' }).subscribe();
    const employees = http.expectOne((req) => req.url.endsWith('/groups/employees'));
    expect(employees.request.urlWithParams).toContain('groupValue=C%2B%2B');
    employees.flush({});
  });

  it('sends a roll-up company on the stats, the groups and the drawer, and none without one', () => {
    const rollUp = 'family-001000000000000AAA';
    const company = { accountId: '001000000000000BBB', name: 'Acme Labs' };

    service.getTrainingStats(rollUp, QUERY, company.accountId).subscribe();
    const stats = http.expectOne((req) => req.url === `/api/orgs/${rollUp}/lens/training/stats`);
    expect(stats.request.params.get('company')).toBe(company.accountId);
    stats.flush({});

    service.getGroups(rollUp, QUERY, { groupBy: 'course', tab: 'trainings', company: company.accountId }).subscribe();
    const groups = http.expectOne((req) => req.url.endsWith('/groups'));
    expect(groups.request.params.get('company')).toBe(company.accountId);
    groups.flush({});

    service.getGroupEmployees(rollUp, QUERY, { groupBy: 'course', groupValue: 'C', tab: 'trainings', status: 'completed', company }).subscribe();
    const employees = http.expectOne((req) => req.url.endsWith('/groups/employees'));
    expect(employees.request.params.get('company')).toBe(company.accountId);
    employees.flush({});

    service.getTrainingStats('org-1', QUERY).subscribe();
    const single = http.expectOne((req) => req.url.endsWith('/stats'));
    expect(single.request.params.has('company')).toBe(false);
    single.flush({});
  });
});
