// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, input, model, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { OrgLensMembershipsService } from '@app/shared/services/org-lens-memberships.service';
import { OrgLensNavigationService } from '@app/shared/services/org-lens-navigation.service';
import type { OrgMembershipProject } from '@lfx-one/shared/interfaces';
import { DrawerModule } from 'primeng/drawer';
import { InputTextModule } from 'primeng/inputtext';
import { catchError, finalize, of, switchMap } from 'rxjs';

/**
 * Side panel behind the Org Projects count on the active-memberships table: the projects the org
 * is involved in for one foundation. The BFF reads the same detail model the count is rolled up
 * from, so the row count here always matches the number the user clicked.
 */
@Component({
  selector: 'lfx-membership-projects-drawer',
  imports: [FormsModule, RouterLink, DrawerModule, InputTextModule, DecimalPipe],
  templateUrl: './membership-projects-drawer.component.html',
})
export class MembershipProjectsDrawerComponent {
  private readonly membershipsService = inject(OrgLensMembershipsService);
  private readonly orgLens = inject(OrgLensNavigationService);

  public readonly visible = model<boolean>(false);
  public readonly orgUid = input<string>('');
  public readonly foundationId = input<string>('');
  public readonly foundationName = input<string>('');
  public readonly count = input<number>(0);

  protected readonly searchTerm = signal('');
  protected readonly loading = signal(false);
  protected readonly loadFailed = signal(false);
  protected readonly retryTrigger = signal(0);

  private readonly projectsData = this.initProjectsData();

  protected readonly filteredProjects = computed<OrgMembershipProject[]>(() => this.initFilteredProjects());

  protected projectLink(project: OrgMembershipProject): string[] {
    return this.orgLens.orgLensLink('projects', project.projectSlug || project.projectId);
  }

  protected retry(): void {
    this.retryTrigger.update((v) => v + 1);
  }

  private initFilteredProjects(): OrgMembershipProject[] {
    const term = this.searchTerm().toLowerCase().trim();
    const projects = this.projectsData()?.projects ?? [];
    if (!term) return projects;
    return projects.filter((p) => p.projectName.toLowerCase().includes(term));
  }

  private initProjectsData() {
    // Keyed off the full target rather than `visible` alone so the list refreshes when the row
    // behind the panel changes (e.g. the org switches) while the panel stays open.
    const trigger$ = toObservable(
      computed(() => ({
        visible: this.visible(),
        orgUid: this.orgUid(),
        foundationId: this.foundationId(),
        retry: this.retryTrigger(),
      }))
    );

    return toSignal(
      trigger$.pipe(
        switchMap(({ visible, orgUid, foundationId }) => {
          if (!visible || !orgUid || !foundationId) return of(null);
          this.searchTerm.set('');
          this.loading.set(true);
          this.loadFailed.set(false);
          return this.membershipsService.getFoundationProjects(orgUid, foundationId).pipe(
            catchError(() => {
              this.loadFailed.set(true);
              return of({ accountId: orgUid, foundationId, projects: [] });
            }),
            finalize(() => this.loading.set(false))
          );
        })
      ),
      { initialValue: null }
    );
  }
}
