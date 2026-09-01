// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe } from '@angular/common';
import { Component, computed, inject, input, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { AvatarComponent } from '@components/avatar/avatar.component';
import { TagComponent } from '@components/tag/tag.component';
import { environment } from '@environments/environment';
import { PROJECT_STAFF_ROWS } from '@lfx-one/shared/constants';
import { ProjectSettings, ProjectStaffRow } from '@lfx-one/shared/interfaces';
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
 * Reads `ProjectContextService.activeProject` for project fields rather than an independent
 * `getProject` call — this card only ever renders for the currently active project, so the
 * context service's already-in-flight fetch is the correct (and only) source.
 */
@Component({
  selector: 'lfx-formation-card',
  imports: [AvatarComponent, TagComponent, SkeletonModule, DatePipe],
  templateUrl: './formation-card.component.html',
})
export class FormationCardComponent {
  private readonly permissionsService = inject(PermissionsService);
  private readonly personaService = inject(PersonaService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly projectService = inject(ProjectService);

  public readonly projectUid = input.required<string>();

  // `loading`, `hasError`, and `loaded` track the settings fetch only — mirrors
  // `ProjectStaffCardComponent`. `project` comes from `ProjectContextService`, which already
  // resolves fetch failures to `null` (same convention as `canWrite`), so there's no separate
  // error state to track for it.
  protected readonly loading = signal(true);
  protected readonly hasError = signal(false);
  protected readonly loaded = signal(false);

  protected readonly isLFStaff = computed(() => this.personaService.isLFStaff());

  protected readonly project = this.projectContextService.activeProject;
  protected readonly formationSubStage = this.projectContextService.activeProjectFormationSubStage;

  protected readonly settings: Signal<ProjectSettings | null> = this.initSettings();
  protected readonly staff: Signal<ProjectStaffRow[]> = computed(() => {
    const s = this.settings();
    return PROJECT_STAFF_ROWS.map((row) => ({
      ...row,
      user: s?.[row.key],
    }));
  });

  protected readonly repositoryUrl: Signal<string | null> = this.initRepositoryUrl();
  protected readonly sfid: Signal<string | null> = this.initSfid();

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

  private initSettings(): Signal<ProjectSettings | null> {
    return toSignal(
      toObservable(this.projectUid).pipe(
        filter((uid): uid is string => !!uid),
        tap(() => {
          this.loading.set(true);
          this.hasError.set(false);
          this.loaded.set(false);
        }),
        switchMap((uid) =>
          this.permissionsService.getProjectSettings(uid).pipe(
            tap(() => {
              this.loading.set(false);
              this.loaded.set(true);
            }),
            catchError((error) => {
              console.error('Formation card: failed to load project settings', error);
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
  }

  /** `null` when missing, or when the scheme isn't http(s) — never bind an unvalidated URL to `[href]`. */
  private initRepositoryUrl(): Signal<string | null> {
    return computed(() => {
      const url = this.project()?.repository_url;
      if (!url) return null;
      try {
        const parsed = new URL(url);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? url : null;
      } catch {
        return null;
      }
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

  private pccBaseUrl(): string {
    const base = environment.urls.pcc;
    return base.endsWith('/') ? base.slice(0, -1) : base;
  }
}
