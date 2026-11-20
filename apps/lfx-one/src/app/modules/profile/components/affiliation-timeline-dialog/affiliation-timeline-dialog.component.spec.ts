// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AffiliationSegment, TimelineProjectData } from '@lfx-one/shared/interfaces';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { describe, expect, it, vi } from 'vitest';

import { AffiliationTimelineDialogComponent } from './affiliation-timeline-dialog.component';

describe('AffiliationTimelineDialogComponent', () => {
  let mockRef: { close: ReturnType<typeof vi.fn> };

  async function createComponent(projectData: TimelineProjectData): Promise<{
    comp: AffiliationTimelineDialogComponent;
    fixture: ComponentFixture<AffiliationTimelineDialogComponent>;
  }> {
    TestBed.resetTestingModule();

    mockRef = { close: vi.fn() };
    const mockConfig = {
      data: {
        projects: [projectData],
        startProjectIndex: 0,
        workExperience: [],
      },
    };

    TestBed.configureTestingModule({
      imports: [AffiliationTimelineDialogComponent],
      providers: [
        { provide: DynamicDialogRef, useValue: mockRef },
        { provide: DynamicDialogConfig, useValue: mockConfig },
      ],
    });

    TestBed.overrideComponent(AffiliationTimelineDialogComponent, {
      set: { template: '', imports: [] },
    });

    const fixture = TestBed.createComponent(AffiliationTimelineDialogComponent);
    const comp = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();

    return { comp, fixture };
  }

  it('preserves Maintainer role and roleSource when saving edits (#5765)', async () => {
    const projectWithMaintainer: TimelineProjectData = {
      projectName: 'Test Project',
      segments: [
        {
          id: 'seg-1',
          role: 'Maintainer',
          roleSource: 'repo-file',
          organization: 'Acme Corp',
          startDate: 'Jan 2022',
          endDate: 'Dec 2023',
          sourceLabel: 'Confirmed by user',
          sourceType: 'user-confirmed',
          needsConfirmation: false,
        },
      ],
    };

    const { comp } = await createComponent(projectWithMaintainer);

    comp.save();

    expect(mockRef.close).toHaveBeenCalledTimes(1);
    const result = mockRef.close.mock.calls[0][0] as { projects: TimelineProjectData[] };
    expect(result.projects[0].segments).toHaveLength(1);
    expect(result.projects[0].segments[0].role).toBe('Maintainer');
    expect(result.projects[0].segments[0].roleSource).toBe('repo-file');
    expect(result.projects[0].segments[0].needsConfirmation).toBe(false);
  });

  it('preserves distinct roles across multiple segments and does not promote Contributor to Maintainer (#5765)', async () => {
    const projectWithMixedSegments: TimelineProjectData = {
      projectName: 'Mixed Project',
      segments: [
        {
          id: 'seg-contrib',
          role: 'Contributor',
          roleSource: 'cdp-detected',
          organization: 'Org A',
          startDate: 'Jan 2020',
          endDate: 'Dec 2021',
          sourceLabel: 'Derived from work experience',
          sourceType: 'inferred',
          needsConfirmation: false,
        },
        {
          id: 'seg-maint',
          role: 'Maintainer',
          roleSource: 'repo-file',
          organization: 'Org B',
          startDate: 'Jan 2022',
          endDate: 'Dec 2023',
          sourceLabel: 'Confirmed by user',
          sourceType: 'user-confirmed',
          needsConfirmation: false,
        },
      ],
    };

    const { comp } = await createComponent(projectWithMixedSegments);

    comp.save();

    expect(mockRef.close).toHaveBeenCalledTimes(1);
    const result = mockRef.close.mock.calls[0][0] as { projects: TimelineProjectData[] };
    expect(result.projects[0].segments).toHaveLength(2);

    const orgASeg = result.projects[0].segments.find((s: AffiliationSegment) => s.organization === 'Org A');
    const orgBSeg = result.projects[0].segments.find((s: AffiliationSegment) => s.organization === 'Org B');

    expect(orgASeg?.role).toBe('Contributor');
    expect(orgASeg?.roleSource).toBe('cdp-detected');
    expect(orgASeg?.sourceType).toBe('inferred');
    expect(orgASeg?.sourceLabel).toBe('Derived from work experience');

    expect(orgBSeg?.role).toBe('Maintainer');
    expect(orgBSeg?.roleSource).toBe('repo-file');
    expect(orgBSeg?.sourceType).toBe('user-confirmed');
    expect(orgBSeg?.sourceLabel).toBe('Confirmed by user');
  });

  it('does not promote a newly added organization to Maintainer when an existing Maintainer segment exists (#5765)', async () => {
    const projectWithMaintainer: TimelineProjectData = {
      projectName: 'Maintainer Project',
      segments: [
        {
          id: 'seg-maint',
          role: 'Maintainer',
          roleSource: 'repo-file',
          organization: 'Org B',
          startDate: 'Jan 2022',
          endDate: 'Dec 2023',
          sourceLabel: 'Repository file',
          sourceType: 'repo-file',
          needsConfirmation: false,
        },
      ],
    };

    const { comp } = await createComponent(projectWithMaintainer);

    // Add a newly enabled organization (Org C)
    comp.organizations.update((orgs) => [
      ...orgs,
      {
        organization: 'Org C',
        enabled: true,
        weWindows: [],
        periods: [
          {
            id: 'p-new',
            startMonth: 'Feb',
            startYear: '2024',
            endMonth: '',
            endYear: '',
            isPresent: true,
          },
        ],
      },
    ]);

    comp.save();

    expect(mockRef.close).toHaveBeenCalledTimes(1);
    const result = mockRef.close.mock.calls[0][0] as { projects: TimelineProjectData[] };
    const newSeg = result.projects[0].segments.find((s: AffiliationSegment) => s.organization === 'Org C');
    const maintSeg = result.projects[0].segments.find((s: AffiliationSegment) => s.organization === 'Org B');

    expect(maintSeg?.role).toBe('Maintainer');
    expect(maintSeg?.roleSource).toBe('repo-file');
    expect(maintSeg?.sourceType).toBe('repo-file');
    expect(maintSeg?.sourceLabel).toBe('Repository file');

    expect(newSeg?.role).toBe('Contributor');
    expect(newSeg?.roleSource).toBe('user-confirmed');
    expect(newSeg?.sourceType).toBe('user-confirmed');
    expect(newSeg?.sourceLabel).toBe('Confirmed by user');
    expect(newSeg?.needsConfirmation).toBe(false);
  });

  it('defaults to Contributor role when project has no prior segments (#5765)', async () => {
    const projectWithoutSegments: TimelineProjectData = {
      projectName: 'New Project',
      segments: [],
    };

    const { comp } = await createComponent(projectWithoutSegments);

    // Enable an organization and add a period
    comp.organizations.set([
      {
        organization: 'Independent',
        enabled: true,
        weWindows: [],
        periods: [
          {
            id: 'p-1',
            startMonth: 'Jan',
            startYear: '2024',
            endMonth: '',
            endYear: '',
            isPresent: true,
          },
        ],
      },
    ]);

    comp.save();

    expect(mockRef.close).toHaveBeenCalledTimes(1);
    const result = mockRef.close.mock.calls[0][0];
    expect(result.projects[0].segments).toHaveLength(1);
    expect(result.projects[0].segments[0].role).toBe('Contributor');
    expect(result.projects[0].segments[0].roleSource).toBe('user-confirmed');
    expect(result.projects[0].segments[0].needsConfirmation).toBe(false);
  });

  it('preserves distinct Contributor and Maintainer periods for the same organization (#5765)', async () => {
    const projectWithSameOrgMixedSegments: TimelineProjectData = {
      projectName: 'Same Org Project',
      segments: [
        {
          id: 'seg-same-org-contrib',
          role: 'Contributor',
          roleSource: 'cdp-detected',
          organization: 'Acme Corp',
          startDate: 'Jan 2020',
          endDate: 'Dec 2021',
          sourceLabel: 'Derived from work experience',
          sourceType: 'inferred',
          needsConfirmation: false,
        },
        {
          id: 'seg-same-org-maint',
          role: 'Maintainer',
          roleSource: 'repo-file',
          organization: 'Acme Corp',
          startDate: 'Jan 2022',
          endDate: 'Dec 2023',
          sourceLabel: 'Repository file',
          sourceType: 'repo-file',
          needsConfirmation: false,
        },
      ],
    };

    const { comp } = await createComponent(projectWithSameOrgMixedSegments);
    comp.save();

    expect(mockRef.close).toHaveBeenCalledTimes(1);
    const result = mockRef.close.mock.calls[0][0] as { projects: TimelineProjectData[] };
    expect(result.projects[0].segments).toHaveLength(2);

    const contribSeg = result.projects[0].segments.find((s: AffiliationSegment) => s.id === 'seg-same-org-contrib');
    const maintSeg = result.projects[0].segments.find((s: AffiliationSegment) => s.id === 'seg-same-org-maint');

    expect(contribSeg?.role).toBe('Contributor');
    expect(contribSeg?.roleSource).toBe('cdp-detected');
    expect(maintSeg?.role).toBe('Maintainer');
    expect(maintSeg?.roleSource).toBe('repo-file');
  });

  it('does not promote a newly added period under an organization with multiple mixed segments (#5765)', async () => {
    const projectWithSameOrgMixedSegments: TimelineProjectData = {
      projectName: 'Same Org Project',
      segments: [
        {
          id: 'seg-contrib-1',
          role: 'Contributor',
          roleSource: 'cdp-detected',
          organization: 'Acme Corp',
          startDate: 'Jan 2020',
          endDate: 'Dec 2021',
          sourceLabel: 'Derived from work experience',
          sourceType: 'inferred',
          needsConfirmation: false,
        },
        {
          id: 'seg-maint-1',
          role: 'Maintainer',
          roleSource: 'repo-file',
          organization: 'Acme Corp',
          startDate: 'Jan 2022',
          endDate: 'Dec 2023',
          sourceLabel: 'Repository file',
          sourceType: 'repo-file',
          needsConfirmation: false,
        },
      ],
    };

    const { comp } = await createComponent(projectWithSameOrgMixedSegments);

    // Add a new third period to Acme Corp with a new period ID
    comp.organizations.update((orgs) =>
      orgs.map((org) => {
        if (org.organization === 'Acme Corp') {
          return {
            ...org,
            periods: [
              ...org.periods,
              {
                id: 'new-period-id',
                startMonth: 'Jan',
                startYear: '2024',
                endMonth: '',
                endYear: '',
                isPresent: true,
              },
            ],
          };
        }
        return org;
      })
    );

    comp.save();

    expect(mockRef.close).toHaveBeenCalledTimes(1);
    const result = mockRef.close.mock.calls[0][0] as { projects: TimelineProjectData[] };
    expect(result.projects[0].segments).toHaveLength(3);

    const newSeg = result.projects[0].segments.find((s: AffiliationSegment) => s.id === 'new-period-id');
    expect(newSeg?.role).toBe('Contributor');
    expect(newSeg?.roleSource).toBe('user-confirmed');
    expect(newSeg?.sourceType).toBe('user-confirmed');
    expect(newSeg?.sourceLabel).toBe('Confirmed by user');
    expect(newSeg?.needsConfirmation).toBe(false);
  });

  it('safely falls back to Contributor for an unlinked/edited period whose dates do not match when multiple segments exist (#5765)', async () => {
    const projectWithMultipleSegments: TimelineProjectData = {
      projectName: 'Multiple Segments Project',
      segments: [
        {
          id: 'seg-1',
          role: 'Contributor',
          roleSource: 'cdp-detected',
          organization: 'Acme Corp',
          startDate: 'Jan 2020',
          endDate: 'Dec 2021',
          sourceLabel: 'Derived from work experience',
          sourceType: 'inferred',
          needsConfirmation: false,
        },
        {
          id: 'seg-2',
          role: 'Maintainer',
          roleSource: 'repo-file',
          organization: 'Acme Corp',
          startDate: 'Jan 2022',
          endDate: 'Dec 2023',
          sourceLabel: 'Repository file',
          sourceType: 'repo-file',
          needsConfirmation: false,
        },
      ],
    };

    const { comp } = await createComponent(projectWithMultipleSegments);

    // Replace periods with an unlinked period having dates that match neither seg-1 nor seg-2
    comp.organizations.update((orgs) =>
      orgs.map((org) => {
        if (org.organization === 'Acme Corp') {
          return {
            ...org,
            periods: [
              {
                id: 'unmatched-id',
                startMonth: 'Jun',
                startYear: '2018',
                endMonth: 'Nov',
                endYear: '2019',
                isPresent: false,
              },
            ],
          };
        }
        return org;
      })
    );

    comp.save();

    expect(mockRef.close).toHaveBeenCalledTimes(1);
    const result = mockRef.close.mock.calls[0][0] as { projects: TimelineProjectData[] };
    expect(result.projects[0].segments).toHaveLength(1);

    const savedSeg = result.projects[0].segments[0];
    expect(savedSeg.role).toBe('Contributor');
    expect(savedSeg.roleSource).toBe('user-confirmed');
    expect(savedSeg.sourceType).toBe('user-confirmed');
    expect(savedSeg.sourceLabel).toBe('Confirmed by user');
  });

  it('closes dialog with null on cancel', async () => {
    const project: TimelineProjectData = {
      projectName: 'Project 3',
      segments: [],
    };

    const { comp } = await createComponent(project);
    comp.cancel();

    expect(mockRef.close).toHaveBeenCalledWith(null);
  });
});
