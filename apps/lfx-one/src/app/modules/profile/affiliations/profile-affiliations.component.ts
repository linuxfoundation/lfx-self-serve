// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { MenuComponent } from '@components/menu/menu.component';
import { TableComponent } from '@components/table/table.component';
import { TagComponent } from '@components/tag/tag.component';
import {
  AffiliationSegment,
  AffiliationTimelineDialogData,
  CdpProjectAffiliation,
  CdpProjectAffiliationEntry,
  DisabledOrgSuggestion,
  FlatAffiliationRow,
  MaintainerConfirmationResult,
  ProjectAffiliationPatchBody,
  ProjectGroup,
  TimelineProjectData,
  WorkExperienceEntry,
} from '@lfx-one/shared/interfaces';
import { LFX_ONE_WORK_EXPERIENCE_SOURCE } from '@lfx-one/shared/constants';
import { abbreviatedMonthYearToIsoDate, isoDateToMonthYear } from '@lfx-one/shared/utils';
import { Router } from '@angular/router';
import { MenuItem, MessageService } from 'primeng/api';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { TooltipModule } from 'primeng/tooltip';
import { catchError, forkJoin, map, Observable, of, take } from 'rxjs';

import { ProjectService } from '../../../shared/services/project.service';
import { UserService } from '../../../shared/services/user.service';
import { AffiliationTimelineDialogComponent } from '../components/affiliation-timeline-dialog/affiliation-timeline-dialog.component';
import { HowAffiliationsWorkDialogComponent } from '../components/how-affiliations-work-dialog/how-affiliations-work-dialog.component';
import { MaintainerConfirmationDialogComponent } from '../components/maintainer-confirmation-dialog/maintainer-confirmation-dialog.component';

@Component({
  selector: 'lfx-profile-affiliations',
  imports: [ButtonComponent, CardComponent, MenuComponent, TableComponent, TagComponent, TooltipModule],
  providers: [DialogService],
  templateUrl: './profile-affiliations.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfileAffiliationsComponent {
  private readonly dialogService = inject(DialogService);
  private readonly messageService = inject(MessageService);
  private readonly router = inject(Router);
  private readonly userService = inject(UserService);
  private readonly projectService = inject(ProjectService);

  public readonly hideHeader = input(false);
  public readonly compact = input(false);
  public readonly projectGroups = signal<ProjectGroup[]>([]);
  public readonly loading = signal(true);
  public readonly isAffiliationHistoryConfirmed = signal(false);
  public readonly workExperience = signal<WorkExperienceEntry[]>([]);
  public readonly addWorkExperience = output();

  private readonly cdpAffiliations = signal<CdpProjectAffiliation[]>([]);
  private readonly lfxSlugs = signal<Set<string>>(new Set());

  public readonly apiProjectGroups: Signal<ProjectGroup[]> = this.initApiProjectGroups();
  public readonly sortedProjectGroups: Signal<ProjectGroup[]> = this.initSortedProjectGroups();
  public readonly isEmpty: Signal<boolean> = computed(() => this.projectGroups().length === 0);

  public readonly flattenedRows: Signal<FlatAffiliationRow[]> = this.initFlattenedRows();
  public readonly roleMenuItemsMap: Signal<Map<string, MenuItem[]>> = this.initRoleMenuItemsMap();
  public readonly projectMenuItemsMap: Signal<Map<string, MenuItem[]>> = this.initProjectMenuItemsMap();
  public readonly affiliationMenuItemsMap: Signal<Map<string, MenuItem[]>> = this.initAffiliationMenuItemsMap();

  public constructor() {
    effect(() => {
      const groups = this.apiProjectGroups();
      if (groups.length > 0 || !this.loading()) {
        this.projectGroups.set(groups);
        this.loading.set(false);
      }
    });
  }

  public refreshWorkExperience(): void {
    this.userService
      .getWorkExperiences()
      .pipe(take(1))
      .subscribe((we) => {
        this.workExperience.set(we);

        // Prune cached CDP affiliations: remove project-type entries
        // for orgs that no longer exist in work experience
        const currentOrgIds = new Set(we.filter((w) => w.organizationId).map((w) => w.organizationId!));
        const lfid = this.userService.user()?.username || this.userService.user()?.['https://sso.linuxfoundation.org/claims/username'] || '';

        const pruned = this.cdpAffiliations().map((project) => ({
          ...project,
          affiliations: project.affiliations.filter((aff) => {
            if (aff.type !== 'project') return true;
            if (currentOrgIds.has(aff.organizationId)) return true;
            if (aff.verifiedBy !== lfid) return true;
            return false;
          }),
        }));
        this.cdpAffiliations.set(pruned);

        if (this.cdpAffiliations().length > 0) {
          this.projectGroups.set(this.transformToProjectGroups(this.cdpAffiliations(), this.lfxSlugs()));
        }
      });
  }

  public openMaintainerConfirmation(project: ProjectGroup): void {
    const dialogRef = this.dialogService.open(MaintainerConfirmationDialogComponent, {
      header: 'Verify your role',
      width: '380px',
      modal: true,
      closable: true,
      dismissableMask: false,
      data: { projectName: project.projectName },
    }) as DynamicDialogRef;

    dialogRef.onClose.pipe(take(1)).subscribe((result: MaintainerConfirmationResult | null) => {
      if (result) {
        this.handleRoleChange(project.id, result === 'maintainer' ? 'Maintainer' : 'Contributor');
      }
    });
  }

  public openAffiliationTimeline(): void {
    const timelineProjects: TimelineProjectData[] = this.projectGroups().map((group) => ({
      projectName: group.projectName,
      segments: [...group.segments],
      disabledOrgSuggestions: group.disabledOrgSuggestions ?? [],
    }));

    const data: AffiliationTimelineDialogData = { projects: timelineProjects, workExperience: this.workExperience() };

    const dialogRef = this.dialogService.open(AffiliationTimelineDialogComponent, {
      header: 'Edit project affiliation(s)',
      width: '720px',
      modal: true,
      closable: true,
      dismissableMask: false,
      data,
    }) as DynamicDialogRef;

    dialogRef.onClose.pipe(take(1)).subscribe((result: { projects: TimelineProjectData[] } | null) => {
      if (result) {
        this.isAffiliationHistoryConfirmed.set(true);
        this.mergeTimelineResult(result.projects);
        this.persistAffiliationChanges(result.projects);
      }
    });
  }

  public openHowItWorks(): void {
    this.dialogService.open(HowAffiliationsWorkDialogComponent, {
      header: 'How affiliations work',
      width: '520px',
      modal: true,
      closable: true,
      dismissableMask: false,
    });
  }

  public navigateToIdentities(): void {
    void this.router.navigate(['/profile', 'identities']);
  }

  private openSingleProjectTimeline(project: ProjectGroup): void {
    const timelineProjects: TimelineProjectData[] = [
      {
        projectName: project.projectName,
        segments: [...project.segments],
        disabledOrgSuggestions: project.disabledOrgSuggestions ?? [],
      },
    ];

    const data: AffiliationTimelineDialogData = { projects: timelineProjects, startProjectIndex: 0, workExperience: this.workExperience() };

    const dialogRef = this.dialogService.open(AffiliationTimelineDialogComponent, {
      header: 'Edit project affiliation(s)',
      width: '720px',
      modal: true,
      closable: true,
      dismissableMask: false,
      data,
    }) as DynamicDialogRef;

    dialogRef.onClose.pipe(take(1)).subscribe((result: { projects: TimelineProjectData[] } | null) => {
      if (result) {
        this.mergeTimelineResult(result.projects);
        this.persistAffiliationChanges(result.projects);
      }
    });
  }

  private mergeTimelineResult(updatedProjects: TimelineProjectData[]): void {
    const groups = [...this.projectGroups()];
    for (const updated of updatedProjects) {
      const idx = groups.findIndex((g) => g.projectName === updated.projectName);
      if (idx === -1) continue;

      if (updated.segments.length > 0) {
        groups[idx] = { ...groups[idx], segments: updated.segments };
      } else {
        const originalSegments = groups[idx].segments;
        const earliest = originalSegments.reduce((min, seg) => (seg.startDate < min ? seg.startDate : min), originalSegments[0]?.startDate || 'Jan 2020');
        groups[idx] = {
          ...groups[idx],
          segments: [
            {
              id: `${groups[idx].id}-independent`,
              role: 'Contributor' as const,
              roleSource: 'user-overridden' as const,
              organization: 'Independent',
              startDate: earliest,
              sourceLabel: 'Confirmed by user' as const,
              sourceType: 'user-overridden' as const,
              needsConfirmation: false,
            },
          ],
        };
      }
    }
    this.projectGroups.set(groups);
  }

  private handleRoleChange(projectId: string, newRole: 'Maintainer' | 'Contributor'): void {
    const updated = this.projectGroups().map((group) => {
      if (group.id !== projectId) {
        return group;
      }
      return {
        ...group,
        segments: group.segments.map((seg) => ({
          ...seg,
          role: newRole,
          roleSource: 'user-overridden' as const,
          needsConfirmation: false,
        })),
      };
    });
    this.projectGroups.set(updated);
  }

  private persistAffiliationChanges(updatedProjects: TimelineProjectData[]): void {
    const lfid = this.userService.user()?.username || this.userService.user()?.['https://sso.linuxfoundation.org/claims/username'] || '';
    const cdpAffiliations = this.cdpAffiliations();
    const orgLookup = this.buildOrgLookup(cdpAffiliations);
    const ops: Observable<{ success: boolean }>[] = [];

    for (const updated of updatedProjects) {
      const cdpProject = cdpAffiliations.find((p) => p.projectName === updated.projectName);
      if (!cdpProject) continue;

      const affiliations: CdpProjectAffiliationEntry[] = updated.segments
        .filter((seg) => seg.organization !== 'Independent')
        .map((seg) => {
          const orgMeta = orgLookup.get(seg.organization);
          const isTemporaryId = !seg.id || seg.id.startsWith('period-') || seg.id.endsWith('-independent');

          return {
            id: isTemporaryId ? '' : seg.id,
            organizationLogo: seg.organizationLogo || orgMeta?.organizationLogo || '',
            organizationId: orgMeta?.organizationId || '',
            organizationName: seg.organization,
            verified: true,
            verifiedBy: lfid,
            source: orgMeta?.source || LFX_ONE_WORK_EXPERIENCE_SOURCE,
            startDate: abbreviatedMonthYearToIsoDate(seg.startDate),
            endDate: seg.endDate ? abbreviatedMonthYearToIsoDate(seg.endDate) : null,
            type: 'project',
          };
        });

      const body: ProjectAffiliationPatchBody = {
        id: cdpProject.id,
        projectSlug: cdpProject.projectSlug,
        verified: true,
        verifiedBy: lfid,
        affiliations,
      };

      ops.push(this.userService.patchProjectAffiliation(cdpProject.id, body).pipe(catchError(() => of({ success: false }))));
    }

    if (ops.length > 0) {
      forkJoin(ops)
        .pipe(take(1))
        .subscribe({
          next: () => {
            this.messageService.add({ severity: 'success', summary: 'Success', detail: 'Affiliations updated successfully.' });
          },
          error: () => {
            this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Failed to save some affiliation changes. Please try again.' });
          },
        });
    }
  }

  private buildOrgLookup(cdpAffiliations: CdpProjectAffiliation[]): Map<string, { organizationId: string; organizationLogo: string; source: string }> {
    const lookup = new Map<string, { organizationId: string; organizationLogo: string; source: string }>();

    for (const project of cdpAffiliations) {
      for (const aff of project.affiliations) {
        if (!lookup.has(aff.organizationName)) {
          lookup.set(aff.organizationName, {
            organizationId: aff.organizationId,
            organizationLogo: aff.organizationLogo,
            source: aff.source,
          });
        }
      }
    }

    for (const we of this.workExperience()) {
      if (we.organizationId && !lookup.has(we.organization)) {
        lookup.set(we.organization, {
          organizationId: we.organizationId,
          organizationLogo: we.organizationLogo || '',
          source: we.cdpSource || LFX_ONE_WORK_EXPERIENCE_SOURCE,
        });
      }
    }

    return lookup;
  }

  private initFlattenedRows(): Signal<FlatAffiliationRow[]> {
    return computed(() => {
      const groups = this.sortedProjectGroups();
      const rows: FlatAffiliationRow[] = [];
      for (let g = 0; g < groups.length; g++) {
        const group = groups[g];
        const isLastGroup = g === groups.length - 1;
        for (let i = 0; i < group.segments.length; i++) {
          rows.push({
            group,
            segment: group.segments[i],
            isFirstSegment: i === 0,
            isLastSegmentInGroup: i === group.segments.length - 1,
            isLastGroup,
          });
        }
      }
      return rows;
    });
  }

  private initRoleMenuItemsMap(): Signal<Map<string, MenuItem[]>> {
    return computed(() => {
      const map = new Map<string, MenuItem[]>();
      for (const project of this.sortedProjectGroups()) {
        map.set(project.id, [
          {
            label: 'Contributor',
            command: () => this.handleRoleChange(project.id, 'Contributor'),
          },
        ]);
      }
      return map;
    });
  }

  private initProjectMenuItemsMap(): Signal<Map<string, MenuItem[]>> {
    return computed(() => {
      const map = new Map<string, MenuItem[]>();
      for (const project of this.sortedProjectGroups()) {
        map.set(project.id, [
          {
            label: 'Edit Affiliation',
            icon: 'fa-light fa-pencil',
            command: () => this.openSingleProjectTimeline(project),
          },
        ]);
      }
      return map;
    });
  }

  private initAffiliationMenuItemsMap(): Signal<Map<string, MenuItem[]>> {
    return computed(() => {
      const map = new Map<string, MenuItem[]>();
      for (const project of this.sortedProjectGroups()) {
        for (const segment of project.segments) {
          map.set(segment.id, [
            {
              label: 'Edit Affiliation',
              icon: 'fa-light fa-pencil',
              command: () => this.openSingleProjectTimeline(project),
            },
          ]);
        }
      }
      return map;
    });
  }

  private initSortedProjectGroups(): Signal<ProjectGroup[]> {
    return computed(() => [...this.projectGroups()].sort((a, b) => a.projectName.localeCompare(b.projectName)));
  }

  private initApiProjectGroups(): Signal<ProjectGroup[]> {
    return toSignal(
      forkJoin([this.userService.getCdpProjectAffiliations(), this.projectService.getProjects(), this.userService.getWorkExperiences()]).pipe(
        map(([cdpAffiliations, lfxProjects, workExperiences]) => {
          const lfxSlugs = new Set(lfxProjects.map((p) => p.slug));
          this.cdpAffiliations.set(cdpAffiliations);
          this.lfxSlugs.set(lfxSlugs);
          this.workExperience.set(workExperiences);
          this.loading.set(false);
          return this.transformToProjectGroups(cdpAffiliations, lfxSlugs);
        }),
        catchError(() => {
          this.loading.set(false);
          return of([]);
        })
      ),
      { initialValue: [] }
    );
  }

  private transformToProjectGroups(cdpAffiliations: CdpProjectAffiliation[], lfxSlugs: Set<string>): ProjectGroup[] {
    const lfid = this.userService.user()?.username || this.userService.user()?.['https://sso.linuxfoundation.org/claims/username'] || '';

    const verifiedOrgIds = new Set(
      this.workExperience()
        .filter((we) => !we.needsReview && we.organizationId)
        .map((we) => we.organizationId!)
    );

    return cdpAffiliations
      .filter((project) => project.projectSlug && lfxSlugs.has(project.projectSlug))
      .map((project) => {
        const firstRole = project.roles.length > 0 ? project.roles[0] : undefined;
        const role: 'Maintainer' | 'Contributor' = firstRole?.role === 'Maintainer' ? 'Maintainer' : 'Contributor';
        const roleSource: 'repo-file' | 'cdp-detected' = firstRole?.repoFileUrl ? 'repo-file' : 'cdp-detected';

        const projectAffiliations = project.affiliations.filter(
          (aff) => aff.type === 'project' && (aff.verifiedBy === lfid || verifiedOrgIds.has(aff.organizationId))
        );

        const segments: AffiliationSegment[] =
          projectAffiliations.length > 0
            ? projectAffiliations.map((aff) => {
                return {
                  id: aff.id ?? '',
                  role,
                  roleSource,
                  organization: aff.organizationName,
                  organizationLogo: aff.organizationLogo || undefined,
                  startDate: isoDateToMonthYear(aff.startDate),
                  endDate: aff.endDate ? isoDateToMonthYear(aff.endDate) : undefined,
                  sourceLabel: aff.verified ? ('Confirmed by user' as const) : ('Derived from work experience' as const),
                  sourceType: aff.verified ? ('user-confirmed' as const) : ('inferred' as const),
                  needsConfirmation: !aff.verified && role === 'Maintainer' && roleSource === 'cdp-detected',
                };
              })
            : (() => {
                const allStartDates = project.affiliations.map((a) => a.startDate).filter(Boolean);
                const allEndDates = project.affiliations.map((a) => a.endDate).filter((d): d is string => !!d);
                const earliestStart = allStartDates.length > 0 ? allStartDates.sort()[0] : undefined;
                const latestEnd = allEndDates.length > 0 ? allEndDates.sort().reverse()[0] : undefined;

                return [
                  {
                    id: `${project.id}-independent`,
                    role,
                    roleSource,
                    organization: 'Independent',
                    startDate: earliestStart ? isoDateToMonthYear(earliestStart) : 'Unknown',
                    endDate: latestEnd ? isoDateToMonthYear(latestEnd) : undefined,
                    sourceLabel: 'Derived from work experience' as const,
                    sourceType: 'inferred' as const,
                    needsConfirmation: false,
                  },
                ];
              })();

        const enabledOrgIds = new Set(projectAffiliations.map((aff) => aff.organizationId));
        const disabledOrgSuggestions = this.buildDisabledOrgSuggestions(project, enabledOrgIds, lfid);

        return {
          id: project.id,
          projectName: project.projectName,
          projectLogo: project.projectLogo || undefined,
          segments,
          disabledOrgSuggestions,
        };
      });
  }

  private buildDisabledOrgSuggestions(project: CdpProjectAffiliation, enabledOrgIds: Set<string>, lfid: string): DisabledOrgSuggestion[] {
    const nonProjectAffs = project.affiliations.filter((aff) => aff.type !== 'project' && !enabledOrgIds.has(aff.organizationId) && aff.verifiedBy === lfid);

    const grouped = new Map<string, CdpProjectAffiliationEntry[]>();
    for (const aff of nonProjectAffs) {
      if (!aff.startDate) continue;
      const existing = grouped.get(aff.organizationId);
      if (existing) {
        existing.push(aff);
      } else {
        grouped.set(aff.organizationId, [aff]);
      }
    }

    const suggestions: DisabledOrgSuggestion[] = [];
    for (const [orgId, entries] of grouped) {
      const startDates = entries
        .map((e) => e.startDate)
        .filter(Boolean)
        .sort();
      const endDates = entries
        .map((e) => e.endDate)
        .filter((d): d is string => !!d)
        .sort();
      const first = entries[0];

      suggestions.push({
        organizationName: first.organizationName,
        organizationId: orgId,
        organizationLogo: first.organizationLogo || undefined,
        earliestStartDate: startDates[0],
        latestEndDate: endDates.length > 0 ? endDates[endDates.length - 1] : undefined,
      });
    }

    return suggestions;
  }
}
