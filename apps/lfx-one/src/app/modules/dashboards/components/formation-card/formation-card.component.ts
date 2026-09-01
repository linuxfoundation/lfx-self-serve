// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { AvatarComponent } from '@components/avatar/avatar.component';
import { TagComponent } from '@components/tag/tag.component';
import { environment } from '@environments/environment';
import { PROJECT_STAFF_ROWS } from '@lfx-one/shared/constants';
import { ProjectSettings, ProjectStaffRow } from '@lfx-one/shared/interfaces';
import { formatAnnouncementDateLabel, isValidUrl } from '@lfx-one/shared/utils';
import { PermissionsService } from '@services/permissions.service';
import { PersonaService } from '@services/persona.service';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, filter, of, switchMap, tap } from 'rxjs';

/**
 * The Formation sidebar card (GH-1955) — sub-stage pill, announcement date, the same
 * `executive_director`/`program_manager`/`opportunity_owner` contacts `ProjectStaffCardComponent`
 * shows above it (deliberately — no formation-specific contact fields exist yet; see below), intake
 * fields (repository/logo), and — for `PersonaService.isLFStaff` only — a deep link into the admin
 * tool. Rendered only while the project is Draft/Formation; see
 * `ProjectContextService.isActiveProjectInFormation`.
 *
 * Two intentional substitutions for fields/permissions the ticket asked for that don't exist yet:
 * - **Staff-only gating**: the ticket specifies a `formation_admin` permission, which exists
 *   nowhere in this repo or elsewhere in the `linuxfoundation` org (verified via `gh api`
 *   `search/code`). `isLFStaff` is the closest available gate — narrow this to a real
 *   `formation_admin` grant once one is modeled.
 * - **Contact rows**: the ticket asked for formation lead/coordinator/partner/product-contact
 *   fields, none of which exist upstream (confirmed against `lfx-v2-project-service`'s live
 *   contract). Showing `executive_director`/`program_manager`/`opportunity_owner` here duplicates
 *   `ProjectStaffCardComponent` directly above it in the sidebar — an explicit, approved trade-off
 *   (matches ticket intent over de-duplication) pending those fields landing upstream.
 *
 * The ticket also asked for two distinct admin-tool links ("Edit stage" and "Set up"). Neither a
 * `?tab=` param nor a `/setup` sub-route exists on `environment.urls.pcc` (verified — see
 * `initAdminToolUrl`), so this ships a single link to the bare project page, the only destination
 * actually confirmed to resolve. Both the specific "Edit stage" destination and any dedicated
 * "Set up" sub-page need a product/PCC decision before a more specific link can be built.
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

  // `loading`/`hasError` track the settings fetch only. The sub-stage pill, slug, and intake fields
  // come from `project()`, which is already resolved by the time this card can render at all (the
  // sidebar only mounts it once `isActiveProjectInFormation()` is true, which requires a non-null
  // `activeProject`) — the admin links additionally wait on `sfid()`, its own independent fetch
  // that starts `null`. The template renders all of that independently of this two-state gate,
  // which only covers the staff-rows and announcement-date section.
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
  protected readonly adminToolUrl: Signal<string> = this.initAdminToolUrl();

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
    return computed(() => formatAnnouncementDateLabel(this.settings()?.announcement_date));
  }

  /** `null` when missing, or when the scheme isn't a validated http(s) URL — never bind an unvalidated URL to `[href]`. */
  private initRepositoryUrl(): Signal<string | null> {
    return computed(() => {
      const url = this.project()?.repository_url;
      return url && isValidUrl(url) ? url : null;
    });
  }

  // Only fetched for LF staff — everyone else can never see the admin-tool link this resolves for,
  // so a non-staff viewer shouldn't pay for the round trip. `ProjectService.getProjectSfid` already
  // logs and resolves to `null` on failure — no additional catchError needed here.
  private initSfid(): Signal<string | null> {
    return toSignal(
      toObservable(computed(() => (this.isLFStaff() ? this.projectUid() : null))).pipe(
        filter((uid): uid is string => !!uid),
        switchMap((uid) => this.projectService.getProjectSfid(uid))
      ),
      { initialValue: null }
    );
  }

  /**
   * `environment.urls.pcc` resolves to PCC's v2 frontend (`pcc.dev.platform.linuxfoundation.org` /
   * `projectadmin.lfx.linuxfoundation.org` in prod — confirmed via `lfx-pcc`'s
   * `apps/v2-frontend/serverless.yml` host mappings), whose routing (`pages-routing.module.ts`)
   * declares `project/:id`, `project/:id/operations`, `project/:id/collaboration`,
   * `project/:id/onboarding`, `project/:id/development`, `project/:id/reports`, and no `**`
   * fallback. None of those is an obvious "stage" or "setup" destination, and this card's first
   * two attempts at guessing one (`?tab=` params, then a v1-only `/setup` route neither of which
   * exists on v2) were both wrong. `/project/:id` is the one route confirmed to resolve — use that
   * until product/PCC names the real destination.
   *
   * v2 also declares a `project-formation` route (`projectFormationGuard`), deliberately not used
   * here: it takes no `:id` param, so it can't serve a per-project deep link — it looks like the
   * global Formations queue (#1956), not a per-project stage editor.
   */
  private initAdminToolUrl(): Signal<string> {
    return computed(() => {
      const sfid = this.sfid();
      return sfid ? `${this.pccBaseUrl()}/project/${encodeURIComponent(sfid)}` : '';
    });
  }

  private pccBaseUrl(): string {
    const base = environment.urls.pcc;
    return base.endsWith('/') ? base.slice(0, -1) : base;
  }
}
