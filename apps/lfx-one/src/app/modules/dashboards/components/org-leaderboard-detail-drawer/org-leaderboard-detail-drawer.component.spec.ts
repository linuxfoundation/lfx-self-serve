// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import type { OrgLeaderboardDetailBreakdown } from '@lfx-one/shared/interfaces';
import { OrgLensProjectDetailService } from '@services/org-lens-project-detail.service';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OrgLeaderboardDetailDrawerComponent } from './org-leaderboard-detail-drawer.component';

/**
 * Covers the drawer's fetch contract and the rendering of withheld rows.
 *
 * Both are invisible to a stubbed-null service: the request takes five strings in a fixed order, so a
 * swapped pair still type-checks and still returns data, and a withheld category is only distinguished
 * from a visible one by what the template chooses to print. These assertions therefore serve a real
 * breakdown and read the rendered rows.
 */
describe('OrgLeaderboardDetailDrawerComponent', () => {
  let fixture: ComponentFixture<OrgLeaderboardDetailDrawerComponent>;
  let getLeaderboardBreakdown: ReturnType<typeof vi.fn>;

  const ORG_UID = 'acc-1';
  const SLUG = 'k8s';
  const SUBJECT = '11111111-2222-3333-4444-555555555555';

  // One served category carrying a full ratio, one served on points alone, and one withheld.
  const breakdown: OrgLeaderboardDetailBreakdown = {
    organizationId: SUBJECT,
    organizationName: 'Acme',
    dimension: 'ecosystem',
    range: '1y',
    totalScore: 6.25,
    level: 'Participating',
    isOwnOrganization: false,
    rank: 3,
    totalOrganizations: 41,
    categories: [
      { key: 'collab', points: 0.33, count: 6, projectTotal: 60, projectAllTimeTotal: 600 },
      { key: 'tier', points: 0.66 },
    ],
    withheldCategories: ['meeting'],
  };

  async function open(range: OrgLeaderboardDetailBreakdown['range'] = '1y'): Promise<void> {
    fixture.componentRef.setInput('range', range);
    fixture.componentRef.setInput('visible', true);
    await fixture.whenStable();
  }

  function rowText(key: string): string {
    const row = document.querySelector(`[data-testid="org-leaderboard-detail-category-${key}"]`);
    return row?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  beforeEach(async () => {
    getLeaderboardBreakdown = vi.fn(() => of(breakdown));

    await TestBed.configureTestingModule({
      imports: [OrgLeaderboardDetailDrawerComponent],
      providers: [provideNoopAnimations(), { provide: OrgLensProjectDetailService, useValue: { getLeaderboardBreakdown } }],
    }).compileComponents();

    fixture = TestBed.createComponent(OrgLeaderboardDetailDrawerComponent);
    fixture.componentRef.setInput('dimension', 'ecosystem');
    fixture.componentRef.setInput('organizationId', SUBJECT);
    fixture.componentRef.setInput('orgName', 'Acme');
    fixture.componentRef.setInput('projectName', 'Kubernetes');
    fixture.componentRef.setInput('projectSlug', SLUG);
    fixture.componentRef.setInput('orgUid', ORG_UID);
    fixture.componentRef.setInput('range', '1y');
    await fixture.whenStable();
  });

  it('requests the breakdown with the arguments in the order the endpoint takes them', async () => {
    await open();

    expect(getLeaderboardBreakdown).toHaveBeenCalledWith(ORG_UID, SLUG, 'ecosystem', SUBJECT, '1y');
  });

  it('spends no request while it is closed', async () => {
    fixture.componentRef.setInput('range', '2y');
    await fixture.whenStable();

    expect(getLeaderboardBreakdown).not.toHaveBeenCalled();
  });

  it('re-requests when the range changes while open, so it cannot show another range figures', async () => {
    await open('1y');
    await open('2y');

    expect(getLeaderboardBreakdown).toHaveBeenLastCalledWith(ORG_UID, SLUG, 'ecosystem', SUBJECT, '2y');
    expect(getLeaderboardBreakdown).toHaveBeenCalledTimes(2);
  });

  it('renders a served category with its points and ratio', async () => {
    await open();

    expect(rowText('collab')).toContain('6 of 60');
    expect(rowText('collab')).toContain('0.33 pts');
  });

  it('renders a served category that has points but no count without inventing a ratio', async () => {
    await open();

    expect(rowText('tier')).toContain('0.66 pts');
    expect(rowText('tier')).not.toContain(' of ');
  });

  // The server omits withheld figures entirely, so any figure in this row would be a template
  // regression rather than a data one.
  it('renders a withheld category as name-only, with no figure of any kind', async () => {
    await open();

    const withheld = rowText('meeting');
    expect(withheld).toContain('Meeting Attendance');
    expect(withheld).not.toMatch(/\d/);
  });

  it('discards the payload on close, so reopening cannot show the previous row figures', async () => {
    await open();
    expect(rowText('collab')).toContain('0.33 pts');

    fixture.componentRef.setInput('visible', false);
    await fixture.whenStable();

    expect(rowText('collab')).toBe('');
  });
});
