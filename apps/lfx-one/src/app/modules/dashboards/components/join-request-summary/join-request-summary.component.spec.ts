// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
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
  TestBed.configureTestingModule({ imports: [JoinRequestSummaryComponent], providers: [provideRouter([{ path: '**', children: [] }])] });
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
    for (const id of ['name', 'category', 'project', 'message', 'message-label', 'submitted']) {
      expect(fixture.nativeElement.querySelector(`[data-testid="${PREFIX}-${id}"]`)).toBeNull();
    }
  });

  it('renders the reviewer context, with the applicant name on the same line as the email', () => {
    const fixture = render(
      request({
        applicationApplicantName: 'Pat Applicant',
        applicationProjectName: 'Project Alpha',
        applicationGroupCategory: 'Technical Steering Committee',
        applicationMessage: 'I maintain the upstream driver.',
        applicationSubmittedAt: '2026-10-12T15:30:00Z',
      })
    );

    expect(text(fixture, 'name')).toBe('Pat Applicant');
    expect(text(fixture, 'name')).not.toBeUndefined();
    const name = fixture.nativeElement.querySelector(`[data-testid="${PREFIX}-name"]`) as HTMLElement;
    const email = fixture.nativeElement.querySelector(`[data-testid="${PREFIX}-email"]`) as HTMLElement;
    expect(name.parentElement).toBe(email.parentElement);
    expect(text(fixture, 'category')).toContain('Technical Steering Committee');
    expect(text(fixture, 'project')).toBe('Project: Project Alpha');
    expect(text(fixture, 'message')).toBe('I maintain the upstream driver.');
    expect(text(fixture, 'submitted')).toMatch(/^Requested Oct 1[23], 2026$/);
  });

  it('labels the message as coming from the applicant', () => {
    const fixture = render(request({ applicationMessage: 'Please add me.' }));

    expect(text(fixture, 'message-label')).toBe('Message from applicant');
    expect(text(fixture, 'message')).toBe('Please add me.');
  });

  it('does not render a group description', () => {
    const fixture = render(request({ applicationProjectName: 'Project Alpha' }));

    expect(fixture.nativeElement.querySelector(`[data-testid="${PREFIX}-description"]`)).toBeNull();
  });

  it('links the group name to its tier-prefixed detail page with the project context', () => {
    const fixture = render(request({ applicationIsFoundation: false, applicationProjectSlug: 'project-alpha' }));

    const link = fixture.nativeElement.querySelector(`a[data-testid="${PREFIX}-group"]`) as HTMLAnchorElement;
    expect(link.textContent?.trim()).toBe('Release Team');
    expect(link.getAttribute('href')).toBe('/project/groups/group-1?project=project-alpha');
  });

  it('uses the foundation route for a foundation-owned group', () => {
    const fixture = render(request({ applicationIsFoundation: true, applicationProjectSlug: 'lf' }));

    expect((fixture.nativeElement.querySelector(`a[data-testid="${PREFIX}-group"]`) as HTMLAnchorElement).getAttribute('href')).toBe(
      '/foundation/groups/group-1?project=lf'
    );
  });

  it('falls back to the flat group route when the project tier is unknown', () => {
    const fixture = render(request());

    expect((fixture.nativeElement.querySelector(`a[data-testid="${PREFIX}-group"]`) as HTMLAnchorElement).getAttribute('href')).toBe('/groups/group-1');
  });

  it('shows the group as plain text, not a link, when the row has no group UID', () => {
    const fixture = render(request({ committeeUid: undefined }));

    expect(fixture.nativeElement.querySelector(`a[data-testid="${PREFIX}-group"]`)).toBeNull();
    expect(text(fixture, 'group')).toBe('Release Team');
  });

  it('tells the host when the group link is followed', () => {
    const fixture = render(request());
    let clicks = 0;
    fixture.componentInstance.groupLinkClick.subscribe(() => clicks++);

    (fixture.nativeElement.querySelector(`a[data-testid="${PREFIX}-group"]`) as HTMLAnchorElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(clicks).toBe(1);
  });

  it('renders the applicant message as literal text, never as markup', () => {
    const payload = '<img src="x" onerror="window.__pwned = true"><b>bold</b>';
    const fixture = render(request({ applicationMessage: payload }));

    expect(text(fixture, 'message')).toBe(payload);
    expect(fixture.nativeElement.querySelector('img')).toBeNull();
    expect(fixture.nativeElement.querySelector('b')).toBeNull();
  });

  it('scopes its test ids to the host-provided prefix', () => {
    const fixture = render(request({ applicationProjectName: 'Project Alpha' }), 'pending-actions-drawer-application');

    expect(text(fixture, 'project', 'pending-actions-drawer-application')).toBe('Project: Project Alpha');
    expect(fixture.nativeElement.querySelector(`[data-testid="${PREFIX}-project"]`)).toBeNull();
  });
});
