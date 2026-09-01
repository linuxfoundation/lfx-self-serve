// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { AvatarComponent } from '@components/avatar/avatar.component';
import { TagComponent } from '@components/tag/tag.component';
import { environment } from '@environments/environment';
import { PROJECT_STAFF_ROWS } from '@lfx-one/shared/constants';
import { ProjectSettings, ProjectStaffRow } from '@lfx-one/shared/interfaces';
import { formatIsoDateLabel, isValidUrl } from '@lfx-one/shared/utils';
import { PermissionsService } from '@services/permissions.service';
import { PersonaService } from '@services/persona.service';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, filter, of, switchMap, tap } from 'rxjs';

/**
 * The Formation sidebar card (GH-1955) — sub-stage pill, announcement date, the same
 * `executive_director`/`program_manager`/`opportunity_owner` contacts `ProjectStaffCardComponent`
 * shows above it, intake fields (repository/logo), and — for `PersonaService.isLFStaff` only —
 * deep links into the admin tool. Rendered only while the project is Draft/Formation; see
 * `ProjectContextService.isActiveProjectInFormation`.
 *
 * Reads `ProjectContextService.activeProject` for project fields and its own `uid` (no
 * `projectUid` input) — this card only ever renders for the currently active project, so there's
 * no other project it could mean, and no independent `getProject` call.
 */
@Component({
  selector: 'lfx-formation-card',
  imports: [AvatarComponent, TagComponent, SkeletonModule],
  templateUrl: './formation-card.component.html',
})
export class FormationCardComponent {
  private readonly permissionsService = inject(PermissionsService);
  private readonly personaService = inject(PersonaService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly projectService = inject(ProjectService);

  // `loading`/`hasError` track the settings fetch only — the sub-stage pill, slug, intake fields,
  // and admin links all come from `project()`/`sfid()`, which are already resolved by the time
  // this card can render at all (the sidebar only mounts it once `isActiveProjectInFormation()` is
  // true, which requires a non-null `activeProject`). The template renders those independently of
  // this two-state gate, which only covers the staff-rows and announcement-date section.
  protected readonly loading = signal(true);
  protected readonly hasError = signal(false);

  protected readonly isLFStaff = computed(() => this.personaService.isLFStaff());

  protected readonly project = this.projectContextService.activeProject;
  protected readonly formationSubStage = this.projectContextService.activeProjectFormationSubStage;
  private readonly projectUid = computed(() => this.project()?.uid ?? null);

  protected readonly settings: Signal<ProjectSettings | null> = this.initSettings();
  protected readonly staff: Signal<ProjectStaffRow[]> = this.initStaff();
  protected readonly announcementDateLabel: Signal<string> = this.initAnnouncementDateLabel();

  protected readonly repositoryUrl: Signal<string | null> = this.initRepositoryUrl();
  protected readonly sfid: Signal<string | null> = this.initSfid();
  protected readonly editStageUrl: Signal<string> = this.initAdminToolUrl('stage');
  protected readonly setUpUrl: Signal<string> = this.initAdminToolUrl('setup');

  private initSettings(): Signal<ProjectSettings | null> {
    return toSignal(
      toObservable(this.projectUid).pipe(
        filter((uid): uid is string => !!uid),
        tap(() => {
          this.loading.set(true);
          this.hasError.set(false);
        }),
        switchMap((uid) =>
          this.permissionsService.getProjectSettings(uid).pipe(
            tap(() => {
              this.loading.set(false);
            }),
            catchError((error) => {
              console.error('Formation card: failed to load project settings', error);
              this.loading.set(false);
              this.hasError.set(true);
              return of(null);
            })
          )
        )
      ),
      { initialValue: null }
    );
  }

  private initStaff(): Signal<ProjectStaffRow[]> {
    return computed(() => {
      const s = this.settings();
      return PROJECT_STAFF_ROWS.map((row) => ({
        ...row,
        user: s?.[row.key],
      }));
    });
  }

  private initAnnouncementDateLabel(): Signal<string> {
    return computed(() => {
      const date = this.settings()?.announcement_date;
      return date ? formatIsoDateLabel(date) : 'Not set';
    });
  }

  /** `null` when missing, or when the scheme isn't a validated http(s) URL — never bind an unvalidated URL to `[href]`. */
  private initRepositoryUrl(): Signal<string | null> {
    return computed(() => {
      const url = this.project()?.repository_url;
      return url && isValidUrl(url) ? url : null;
    });
  }

  // `ProjectService.getProjectSfid` already logs and resolves to `null` on failure — no additional
  // catchError needed here.
  private initSfid(): Signal<string | null> {
    return toSignal(
      toObservable(this.projectUid).pipe(
        filter((uid): uid is string => !!uid),
        switchMap((uid) => this.projectService.getProjectSfid(uid))
      ),
      { initialValue: null }
    );
  }

  /**
   * Both deep links use the same `/project/:sfid` PCC route with a distinguishing query param —
   * unverified against the admin tool's actual routing; confirm with product/design before
   * treating either link as final.
   */
  private initAdminToolUrl(tab: 'stage' | 'setup'): Signal<string> {
    return computed(() => {
      const sfid = this.sfid();
      return sfid ? `${this.pccBaseUrl()}/project/${sfid}?tab=${tab}` : '';
    });
  }

  private pccBaseUrl(): string {
    const base = environment.urls.pcc;
    return base.endsWith('/') ? base.slice(0, -1) : base;
  }
}
