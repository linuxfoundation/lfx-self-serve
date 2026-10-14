// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { PendingActionItem } from '@lfx-one/shared/interfaces';
import { describe, expect, it } from 'vitest';

import { JoinRequestSummaryComponent } from './join-request-summary.component';

const PREFIX = 'test-application';

const request = (overrides: Partial<PendingActionItem> = {}): PendingActionItem => ({
  type: 'JoinApplication',
  badge: 'Release Team',
  text: 'applicant@example.com',
  icon: 'fa-light fa-user-check',
  severity: 'warn',
  buttonText: '',
  committeeUid: 'group-1',
  applicationUid: 'application-1',
  applicationApplicantEmail: 'applicant@example.com',
  ...overrides,
});

const render = (item: PendingActionItem, testIdPrefix = PREFIX): ComponentFixture<JoinRequestSummaryComponent> => {
  TestBed.configureTestingModule({ imports: [JoinRequestSummaryComponent] });
  const fixture = TestBed.createComponent(JoinRequestSummaryComponent);
  fixture.componentRef.setInput('item', item);
  fixture.componentRef.setInput('testIdPrefix', testIdPrefix);
  fixture.detectChanges();
  return fixture;
};

const text = (fixture: ComponentFixture<JoinRequestSummaryComponent>, id: string, prefix = PREFIX): string | undefined =>
  fixture.nativeElement.querySelector(`[data-testid="${prefix}-${id}"]`)?.textContent?.trim();

describe('JoinRequestSummaryComponent', () => {
  it('renders only the applicant email and the group when no other context is known', () => {
    const fixture = render(request());

    expect(text(fixture, 'email')).toBe('applicant@example.com');
    expect(text(fixture, 'group')).toBe('Release Team');
    for (const id of ['name', 'category', 'project', 'description', 'message', 'submitted']) {
      expect(fixture.nativeElement.querySelector(`[data-testid="${PREFIX}-${id}"]`)).toBeNull();
    }
  });

  it('renders the full reviewer context when it is known', () => {
    const fixture = render(
      request({
        applicationApplicantName: 'Pat Applicant',
        applicationProjectName: 'Project Alpha',
        applicationGroupCategory: 'Technical Steering Committee',
        applicationGroupDescription: 'Owns the release process.',
        applicationMessage: 'I maintain the upstream driver.',
        applicationSubmittedAt: '2026-10-12T15:30:00Z',
      })
    );

    expect(text(fixture, 'name')).toBe('Pat Applicant');
    expect(text(fixture, 'group')).toBe('Release Team');
    expect(text(fixture, 'category')).toContain('Technical Steering Committee');
    expect(text(fixture, 'project')).toBe('Project: Project Alpha');
    expect(text(fixture, 'description')).toBe('Owns the release process.');
    expect(text(fixture, 'message')).toBe('I maintain the upstream driver.');
    expect(text(fixture, 'submitted')).toMatch(/^Requested Oct 1[23], 2026$/);
  });

  it('renders the applicant message and group text as literal text, never as markup', () => {
    const payload = '<img src="x" onerror="window.__pwned = true"><b>bold</b>';
    const fixture = render(request({ applicationMessage: payload, applicationGroupDescription: payload }));

    expect(text(fixture, 'message')).toBe(payload);
    expect(text(fixture, 'description')).toBe(payload);
    expect(fixture.nativeElement.querySelector('img')).toBeNull();
    expect(fixture.nativeElement.querySelector('b')).toBeNull();
  });

  it('scopes its test ids to the host-provided prefix', () => {
    const fixture = render(request({ applicationProjectName: 'Project Alpha' }), 'pending-actions-drawer-application');

    expect(text(fixture, 'project', 'pending-actions-drawer-application')).toBe('Project: Project Alpha');
    expect(fixture.nativeElement.querySelector(`[data-testid="${PREFIX}-project"]`)).toBeNull();
  });
});
