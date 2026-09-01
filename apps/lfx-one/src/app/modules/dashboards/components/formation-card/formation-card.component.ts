// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, input, PLATFORM_ID, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { AvatarComponent } from '@components/avatar/avatar.component';
import { TagComponent } from '@components/tag/tag.component';
import { environment } from '@environments/environment';
import { PROJECT_STAFF_ROWS } from '@lfx-one/shared/constants';
import { Project, ProjectSettings, ProjectStaffRowConfig, UserInfo } from '@lfx-one/shared/interfaces';
import { getFormationSubStageLabel } from '@lfx-one/shared/utils';
import { PermissionsService } from '@services/permissions.service';
import { PersonaService } from '@services/persona.service';
import { ProjectService } from '@services/project.service';
import { SkeletonModule } from 'primeng/skeleton';
import { TooltipModule } from 'primeng/tooltip';
import { catchError, combineLatest, filter, map, of, switchMap, tap } from 'rxjs';

type StaffRow = ProjectStaffRowConfig & { user: UserInfo | null | undefined };

/**
 * The Formation sidebar card (GH-1955) — sub-stage pill, announcement date, the same
 * `executive_director`/`program_manager`/`opportunity_owner` contacts `ProjectStaffCardComponent`
 * shows above it, intake fields (repository/logo), and — for `PersonaService.isLFStaff` only —
 * deep links into the admin tool. Rendered only while the project is Draft/Formation; see
 * `ProjectContextService.isActiveProjectInFormation`.
 */
@Component({
  selector: 'lfx-formation-card',
  imports: [AvatarComponent, TagComponent, SkeletonModule, TooltipModule],
  templateUrl: './formation-card.component.html',
})
export class FormationCardComponent {
  private readonly permissionsService = inject(PermissionsService);
  private readonly personaService = inject(PersonaService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly projectService = inject(ProjectService);

  public readonly projectUid = input.required<string>();

  // `loading`, `hasError`, and `loaded` are tracked separately so the template can distinguish
  // fetching, fetch failed, and fetch succeeded — mirrors `ProjectStaffCardComponent`.
  protected readonly loading = signal(true);
  protected readonly hasError = signal(false);
  protected readonly loaded = signal(false);

  protected readonly isBrowser = isPlatformBrowser(this.platformId);
  protected readonly isLFStaff = computed(() => this.personaService.isLFStaff());

  private readonly combined: Signal<{ project: Project | null; settings: ProjectSettings | null } | null> = toSignal(
    toObservable(this.projectUid).pipe(
      filter((uid): uid is string => !!uid),
      tap(() => {
        this.loading.set(true);
        this.hasError.set(false);
        this.loaded.set(false);
      }),
      switchMap((uid) =>
        combineLatest([this.projectService.getProject(uid, false), this.permissionsService.getProjectSettings(uid)]).pipe(
          map(([project, settings]) => ({ project, settings })),
          tap(() => {
            this.loading.set(false);
            this.loaded.set(true);
          }),
          catchError(() => {
            this.loading.set(false);
            this.hasError.set(true);
            this.loaded.set(false);
            return of(null);
          })
        )
      )
    ),
    { initialValue: null }
  );

  protected readonly project: Signal<Project | null> = computed(() => this.combined()?.project ?? null);
  protected readonly settings: Signal<ProjectSettings | null> = computed(() => this.combined()?.settings ?? null);
  protected readonly formationSubStage: Signal<string | null> = computed(() => getFormationSubStageLabel(this.project()?.stage));

  protected readonly staff: Signal<StaffRow[]> = computed(() => {
    const s = this.settings();
    return PROJECT_STAFF_ROWS.map((row) => ({
      ...row,
      user: s?.[row.key],
    }));
  });

  protected readonly sfid: Signal<string | null> = toSignal(
    toObservable(this.projectUid).pipe(
      filter((uid): uid is string => !!uid),
      switchMap((uid) => this.projectService.getProjectSfid(uid).pipe(catchError(() => of(null))))
    ),
    { initialValue: null }
  );

  /**
   * Both deep links use the same `/project/:sfid` PCC route with a distinguishing query param —
   * unverified against the admin tool's actual routing; confirm with product/design before
   * treating either link as final.
   */
  protected readonly editStageUrl: Signal<string> = computed(() => {
    const sfid = this.sfid();
    return sfid ? `${this.pccBaseUrl()}/project/${sfid}?tab=stage` : '';
  });
  protected readonly setUpUrl: Signal<string> = computed(() => {
    const sfid = this.sfid();
    return sfid ? `${this.pccBaseUrl()}/project/${sfid}?tab=setup` : '';
  });

  protected openAdminTool(url: string): void {
    if (typeof window !== 'undefined' && url) {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }

  private pccBaseUrl(): string {
    const base = environment.urls.pcc;
    return base.endsWith('/') ? base.slice(0, -1) : base;
  }
}
