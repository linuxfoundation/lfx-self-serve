// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FocusMonitor } from '@angular/cdk/a11y';
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { ACCOUNT_WORK_HISTORY_PATH, PROFILE_GRID_LIMIT, PROFILE_INVOLVEMENT_COPY } from '@lfx-one/shared/constants';
import { CdpProjectAffiliation } from '@lfx-one/shared/interfaces';
import { ProjectService } from '@services/project.service';
import { UserService } from '@services/user.service';
import { Observable, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { ProfileInvolvementComponent } from './profile-involvement.component';

const project = (slug: string, role: string, startDate: string, endDate = ''): CdpProjectAffiliation => ({
  id: slug,
  projectSlug: slug,
  projectName: slug.toUpperCase(),
  projectLogo: `https://logos.example/${slug}.png`,
  contributionCount: 0,
  roles: [{ id: `${slug}-role`, role, startDate, endDate, repoUrl: '', repoFileUrl: '' }],
  affiliations: [],
});

describe('ProfileInvolvementComponent', () => {
  async function render(read: () => Observable<CdpProjectAffiliation[]>) {
    const readCdpProjectAffiliations = vi.fn(read);
    TestBed.configureTestingModule({
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: UserService, useValue: { readCdpProjectAffiliations } },
        { provide: ProjectService, useValue: { getProjectSlugs: () => of(null) } },
      ],
    });
    const fixture = TestBed.createComponent(ProfileInvolvementComponent);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    return {
      fixture,
      readCdpProjectAffiliations,
      host,
      query: (testId: string) => host.querySelector(`[data-testid="${testId}"]`) as HTMLElement | null,
      pills: () => Array.from(host.querySelectorAll('[data-testid^="profile-involvement-project-"]:not([data-testid$="-name"])')) as HTMLElement[],
    };
  }

  it('heads the section with the hint and a way to manage affiliations', async () => {
    const { query } = await render(() => of([]));

    expect(query('profile-involvement-title')?.textContent?.trim()).toBe(PROFILE_INVOLVEMENT_COPY.heading);
    expect(query('profile-section-hint')?.textContent).toContain(PROFILE_INVOLVEMENT_COPY.missingLabel);
    expect(query('profile-involvement-manage')?.querySelector('a')?.getAttribute('href')).toBe(ACCOUNT_WORK_HISTORY_PATH);
  });

  it('shows the empty state for someone with no project activity', async () => {
    const { host, pills } = await render(() => of([]));

    expect(pills()).toHaveLength(0);
    expect(host.textContent).toContain(PROFILE_INVOLVEMENT_COPY.emptyTitle);
  });

  it('shows current projects first, with the role and the years', async () => {
    const { pills } = await render(() => of([project('past', 'Contributor', '2018-01-01', '2020-06-30'), project('kube', 'Maintainer', '2021-03-01')]));

    expect(pills().map((pill) => pill.getAttribute('data-testid'))).toEqual(['profile-involvement-project-kube', 'profile-involvement-project-past']);
    expect(pills()[0].querySelector('lfx-ui-badge')?.textContent?.trim()).toBe('Maintainer');
    expect(pills()[0].textContent).toContain('Since 2021');
    expect(pills()[1].querySelector('lfx-ui-badge')?.textContent?.trim()).toBe('Contributor');
    expect(pills()[1].textContent).toContain('2018 – 2020');
  });

  it('shows nine projects, then all of them', async () => {
    const projects = Array.from({ length: PROFILE_GRID_LIMIT + 1 }, (_, index) => project(`p${index}`, 'Contributor', `20${10 + index}-01-01`));
    const { fixture, pills, query } = await render(() => of(projects));
    expect(pills()).toHaveLength(PROFILE_GRID_LIMIT);

    query('profile-involvement-grid-toggle')?.querySelector('button')?.click();
    await fixture.whenStable();
    expect(pills()).toHaveLength(PROFILE_GRID_LIMIT + 1);
  });

  it('opens a card with the role and the dates on keyboard focus', async () => {
    const { pills } = await render(() => of([project('kube', 'Maintainer', '2021-03-01')]));

    TestBed.inject(FocusMonitor).focusVia(pills()[0], 'keyboard');
    await new Promise((resolve) => setTimeout(resolve));
    const card = document.querySelector('[data-testid="profile-involvement-card-kube"]');

    expect(card?.textContent).toContain('KUBE');
    expect(card?.textContent).toContain('Maintainer');
    expect(card?.textContent).toContain('Since Mar 2021');
  });

  it('says the projects could not load, and tries again', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { fixture, readCdpProjectAffiliations, query, pills } = await render(() => throwError(() => new Error('boom')));
    expect(query('profile-involvement-error')?.textContent).toContain(PROFILE_INVOLVEMENT_COPY.loadFailed);

    readCdpProjectAffiliations.mockImplementation(() => of([project('kube', 'Contributor', '2021-03-01')]));
    query('profile-involvement-retry')?.querySelector('button')?.click();
    await fixture.whenStable();
    expect(pills()).toHaveLength(1);
    warn.mockRestore();
  });
});
