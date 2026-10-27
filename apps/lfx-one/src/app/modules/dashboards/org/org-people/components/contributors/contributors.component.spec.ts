// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormGroup } from '@angular/forms';
import { By } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';
import {
  DEFAULT_ORG_COMMIT_FILTERS,
  EMPTY_ORG_CONTRIBUTORS_RESPONSE,
  ORG_CODE_CONTRIBUTIONS_DEFINITION,
  ORG_COMMITS_DEFINITION,
} from '@lfx-one/shared/constants';
import type { OrgCommitFilters, OrgContributorsResponse, OrgPeopleTimeRange } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { PersonDetailDrawerService } from '@services/person-detail-drawer.service';
import { Tooltip } from 'primeng/tooltip';
import { Observable, of } from 'rxjs';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

import { SYNTHETIC_ORG_ACCOUNT_ID, SYNTHETIC_ORG_NAME } from '../../../../../../../../e2e/fixtures/mock-data/synthetic-org.mock';
import { ContributorsService } from '../../services/contributors.service';
import { ContributorsComponent } from './contributors.component';

const ORG = SYNTHETIC_ORG_ACCOUNT_ID;

/** One person on two projects: commits favour Kubernetes, code contributions favour OpenTelemetry. */
function contributorsResponse(): OrgContributorsResponse {
  return {
    ...EMPTY_ORG_CONTRIBUTORS_RESPONSE,
    accountId: ORG,
    contributors: [
      {
        personKey: 'p-1',
        displayName: 'Ada Lovelace',
        title: null,
        lfid: null,
        lfUsername: null,
        cdpMemberId: 'cdp-1',
        role: 'Contributor',
        commits: 12,
        codeActivities: 340,
        lastActiveTs: '2026-04-12',
        projectsCount: 2,
        mostActiveProjectName: 'Kubernetes',
        mostActiveProjectFoundationName: 'CNCF',
      },
    ],
    projects: [
      {
        personKey: 'p-1',
        projectId: 'k8s',
        projectName: 'Kubernetes',
        projectSlug: 'k8s',
        foundationId: 'cncf',
        foundationName: 'CNCF',
        foundationSlug: 'cncf',
        role: 'Contributor',
        commits: 10,
        codeActivities: 40,
        lastActiveTs: '2026-04-12',
      },
      {
        personKey: 'p-1',
        projectId: 'otel',
        projectName: 'OpenTelemetry',
        projectSlug: 'otel',
        foundationId: 'cncf',
        foundationName: 'CNCF',
        foundationSlug: 'cncf',
        role: 'Contributor',
        commits: 2,
        codeActivities: 300,
        lastActiveTs: '2026-04-01',
      },
    ],
  };
}

describe('ContributorsComponent — commit filters (lfx-self-serve#4164)', () => {
  let fixture: ComponentFixture<ContributorsComponent>;
  let getContributors: Mock<(orgUid: string, timeRange: OrgPeopleTimeRange, filters: OrgCommitFilters) => Observable<OrgContributorsResponse>>;

  const el = (): HTMLElement => fixture.nativeElement;
  const text = (testId: string): string => el().querySelector(`[data-testid="${testId}"]`)?.textContent?.trim() ?? '';
  const form = (): FormGroup => (fixture.componentInstance as unknown as { filterForm: FormGroup }).filterForm;

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function mount(initialUrl = '/'): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [ContributorsComponent],
      providers: [
        provideRouter([]),
        { provide: AccountContextService, useValue: { selectedAccount: signal({ uid: ORG, accountName: SYNTHETIC_ORG_NAME }) } },
        { provide: ContributorsService, useValue: { getContributors } },
        { provide: PersonDetailDrawerService, useValue: { open: vi.fn() } },
      ],
    }).compileComponents();

    await TestBed.inject(Router).navigateByUrl(initialUrl);
    fixture = TestBed.createComponent(ContributorsComponent);
    await settle();
  }

  beforeEach(() => {
    getContributors = vi.fn(() => of(contributorsResponse()));
  });

  it('reads the filters from the URL and sends them to the BFF', async () => {
    await mount('/?projectScope=lf&commitScope=merged');

    expect(getContributors).toHaveBeenLastCalledWith(ORG, '12mo', { projectScope: 'lf', commitScope: 'merged', metric: 'commits' });
  });

  it('reads an unknown value as its default', async () => {
    await mount('/?projectScope=everything&metric=prs');

    expect(getContributors).toHaveBeenLastCalledWith(ORG, '12mo', DEFAULT_ORG_COMMIT_FILTERS);
  });

  it('refetches on a filter change and writes it to the URL, dropping defaults', async () => {
    await mount('/?tab=contributors');

    form().controls['projectScope'].setValue('non_lf');
    await settle();

    expect(getContributors).toHaveBeenLastCalledWith(ORG, '12mo', { ...DEFAULT_ORG_COMMIT_FILTERS, projectScope: 'non_lf' });
    const url = TestBed.inject(Router).url;
    expect(url).toContain('projectScope=non_lf');
    expect(url).toContain('tab=contributors');
    expect(url).not.toContain('commitScope=');
    expect(url).not.toContain('metric=');

    form().controls['projectScope'].setValue('all');
    await settle();

    expect(TestBed.inject(Router).url).not.toContain('projectScope=');
  });

  it('shows commits by default and code contributions under metric=code, with the matching definition', async () => {
    await mount();

    expect(text('org-people-contributors-count-header')).toBe('Commits');
    expect(el().querySelector('[data-testid="org-people-contributors-row-p-1"]')?.textContent).toContain('12');
    let info = fixture.debugElement.query(By.css('[data-testid="org-people-contributors-count-header-info"]'));
    expect(info.injector.get(Tooltip).content).toBe(ORG_COMMITS_DEFINITION);
    expect(form().controls['commitScope'].disabled).toBe(false);

    form().controls['metric'].setValue('code');
    await settle();

    expect(getContributors).toHaveBeenLastCalledWith(ORG, '12mo', { ...DEFAULT_ORG_COMMIT_FILTERS, metric: 'code' });
    expect(text('org-people-contributors-count-header')).toBe('Code contributions');
    expect(el().querySelector('[data-testid="org-people-contributors-row-p-1"]')?.textContent).toContain('340');
    info = fixture.debugElement.query(By.css('[data-testid="org-people-contributors-count-header-info"]'));
    expect(info.injector.get(Tooltip).content).toBe(ORG_CODE_CONTRIBUTIONS_DEFINITION);
    // The commit scope does not apply to code contributions.
    expect(form().controls['commitScope'].disabled).toBe(true);
  });

  it('orders the expanded projects by the metric', async () => {
    await mount('/?metric=code');

    (fixture.componentInstance as unknown as { toggleRow(personKey: string): void }).toggleRow('p-1');
    await settle();

    const detail = el().querySelector('[data-testid="org-people-contributors-row-p-1-detail-row"]')?.textContent ?? '';
    expect(detail.indexOf('OpenTelemetry')).toBeLessThan(detail.indexOf('Kubernetes'));
    expect(detail).toContain('300');
  });
});
