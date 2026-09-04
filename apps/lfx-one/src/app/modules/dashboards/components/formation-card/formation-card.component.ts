// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { TagComponent } from '@components/tag/tag.component';
import { environment } from '@environments/environment';
import { ProjectSettings } from '@lfx-one/shared/interfaces';
import { formatAnnouncementDateLabel } from '@lfx-one/shared/utils';
import { PermissionsService } from '@services/permissions.service';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, filter, map, of, switchMap, tap } from 'rxjs';

/**
 * The Formation sidebar card (GH-1955) — sub-stage pill, announcement date, slug, and — for
 * project `auditor`s (and writers) only — a deep link into the admin tool. Rendered only while the
 * project is Draft/Formation; see `ProjectContextService.isActiveProjectInFormation`.
 *
 * Epic 1 scope (revised #1955, 2 Sep 2026): the card renders only fields the synced record already
 * carries. Formation lead/coordinator/partner contacts and the intake block (repository, assigning
 * org, trademark status, logo) came from the Epic 2 application form — with no intake in Epic 1
 * there's no source for those fields, so they're not on this card. `ProjectStaffCardComponent`
 * directly above this card in the sidebar already covers `executive_director`/`program_manager`/
 * `opportunity_owner`.
 *
 * **Staff-only gating**: FGA defines `writer`/`auditor`/`participant`/`item_owner` on `formation`;
 * GH-1954 grants LF Staff `auditor` (not `writer`) on non-public projects, so the guard checks
 * `auditor` OR `writer` on the project (see `initIsAuditor` below) — a `writer`-only guard would
 * hide this deep link from most of staff.
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
  imports: [TagComponent, SkeletonModule],
  templateUrl: './formation-card.component.html',
})
export class FormationCardComponent {
  private readonly permissionsService = inject(PermissionsService);
  private readonly projectContextService = inject(ProjectContextService);
  private readonly projectService = inject(ProjectService);

  // `loading`/`hasError` track the settings fetch only (it backs the announcement date). The
  // sub-stage pill and slug come from `project()`, which is already resolved by the time this card
  // can render at all (the sidebar only mounts it once `isActiveProjectInFormation()` is true, which
  // requires a non-null `activeProject`) — the admin links additionally wait on `sfid()`, its own
  // independent fetch that starts `null`. The template renders all of that independently of this
  // two-state gate.
  protected readonly loading = signal(true);
  protected readonly hasError = signal(false);

  protected readonly project = this.projectContextService.activeProject;
  protected readonly formationSubStage = this.projectContextService.activeProjectFormationSubStage;
  private readonly projectUid = computed(() => this.project()?.uid ?? null);

  protected readonly settings: Signal<ProjectSettings | null> = this.initSettings();
  protected readonly announcementDateLabel: Signal<string> = this.initAnnouncementDateLabel();

  protected readonly isAuditor: Signal<boolean> = this.initIsAuditor();
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

  private initAnnouncementDateLabel(): Signal<string> {
    return computed(() => formatAnnouncementDateLabel(this.settings()?.announcement_date));
  }

  // Dedicated `auditor` FGA check (GH-1955) — independent of `ProjectContextService.activeProject`,
  // which doesn't request this flag. `writer === true` is load-bearing, not redundant: the server
  // skips the auditor check entirely once a caller is already a writer (a strict superset of
  // access), so a writer's `auditor` field comes back `undefined` — without the OR, a project
  // writer would be wrongly denied this deep link.
  private initIsAuditor(): Signal<boolean> {
    return toSignal(
      toObservable(this.projectUid).pipe(
        filter((uid): uid is string => !!uid),
        switchMap((uid) => this.projectService.getProject(uid, false, { auditor: true })),
        map((project) => project?.writer === true || project?.auditor === true),
        catchError(() => of(false))
      ),
      { initialValue: false }
    );
  }

  // Only fetched once `isAuditor()` resolves true — everyone else can never see the admin-tool link
  // this resolves for, so a non-auditor viewer shouldn't pay for the round trip.
  // `ProjectService.getProjectSfid` already logs and resolves to `null` on failure — no additional
  // catchError needed here.
  private initSfid(): Signal<string | null> {
    return toSignal(
      toObservable(computed(() => (this.isAuditor() ? this.projectUid() : null))).pipe(
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
