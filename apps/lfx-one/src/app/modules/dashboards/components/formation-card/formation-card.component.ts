// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { TagComponent } from '@components/tag/tag.component';
import { environment } from '@environments/environment';
import type { Formation, FormationCardView } from '@lfx-one/shared/interfaces';
import { formatAnnouncementDateLabel, getFormationSubStageLabel } from '@lfx-one/shared/utils';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
import { SkeletonModule } from 'primeng/skeleton';
import { filter, map, switchMap } from 'rxjs';

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
 * **Admin-link gating**: the guard checks `auditor` OR `writer` on the *project* FGA type (see
 * `initIsAuditor` below) — GH-1954 grants LF Staff `auditor` (not `writer`) on non-public
 * projects, so a `writer`-only guard would hide this deep link from most of staff. Note this
 * check resolves wider than "staff": project `writer`s (maintainers, EDs) and `auditor`s
 * inherited from the parent foundation (`project#auditor` cascades from `parent`) also pass it —
 * the chip below is worded accordingly rather than as a literal staff-only claim.
 *
 * The ticket also asked for two distinct admin-tool links ("Edit stage" and "Set up"). Neither a
 * `?tab=` param nor a `/setup` sub-route exists on `environment.urls.pcc` (verified — see
 * `initAdminToolUrl`), so this ships a single link to the bare project page, the only destination
 * actually confirmed to resolve. Both the specific "Edit stage" destination and any dedicated
 * "Set up" sub-page need a product/PCC decision before a more specific link can be built.
 *
 * **Two data sources, one view-model** (`view` below). With the `formation` input set the card
 * renders entirely from an already-loaded `FormationChecklistResponse` and never reads
 * `ProjectContextService` — that's load-bearing on the foundation drill-down
 * (`/foundation/formations/:projectSlug`), where the context service points at the *foundation*,
 * so any partial fallback would render the parent's slug beside the child's checklist (#2719).
 * With the input left `null` (the project dashboard sidebar) it keeps the original behavior:
 * project fields and uid off `ProjectContextService.activeProject`, and the announcement date off
 * its shared `activeProjectAnnouncementDate`/`Loading`/`HasError` signals (GH-1955).
 *
 * The `auditor` gate needs its own fetch either way: it requires a flag neither source carries, so
 * `initIsAuditorState` makes a dedicated `getProject(uid, false, { auditor: true })` call.
 *
 * `isAuditor`/`sfid` are derived from uid-tagged resolved state (`isAuditorState`/`sfidState`),
 * not read directly off the raw `toSignal` result: during a project switch, `activeProject` (and
 * therefore `projectUid`) can advance to the new project before this card's own in-flight
 * `getProject`/`getProjectSfid` calls for the *previous* uid resolve. Gating on `state.uid ===
 * projectUid()` suppresses that stale window instead of briefly showing the previous project's
 * admin-tool link/SFID — mirrors the uid-tagging pattern in `committee-view.component.ts`'s
 * `meetingCoordinatorState`.
 */
@Component({
  selector: 'lfx-formation-card',
  imports: [TagComponent, SkeletonModule],
  templateUrl: './formation-card.component.html',
})
export class FormationCardComponent {
  private readonly projectContextService = inject(ProjectContextService);
  private readonly projectService = inject(ProjectService);

  /**
   * Renders the card from an already-loaded checklist response instead of the project context —
   * both checklist hosts (`/project/formation` and the foundation drill-down
   * `/foundation/formations/:projectSlug`) pass the response their own
   * `lfx-formation-checklist-section` just fetched, so the card costs no extra request and is
   * visible to exactly whoever could read the checklist beside it (#2719). `null` (the default)
   * preserves the original behavior: everything resolves from `ProjectContextService`, as on the
   * project dashboard sidebar.
   */
  public readonly formation = input<Formation | null>(null);

  protected readonly view: Signal<FormationCardView | null> = this.initView();
  /**
   * Announcement-date tri-state. Only meaningful in context mode — in input mode the date arrived
   * with the checklist response, so there is nothing left to load or fail.
   */
  protected readonly loading = computed(() => !this.formation() && this.projectContextService.activeProjectAnnouncementDateLoading());
  protected readonly hasError = computed(() => !this.formation() && this.projectContextService.activeProjectAnnouncementDateHasError());
  private readonly projectUid = computed(() => this.view()?.uid ?? null);

  private readonly isAuditorState: Signal<{ uid: string; isAuditor: boolean } | null> = this.initIsAuditorState();
  protected readonly isAuditor: Signal<boolean> = computed(() => {
    const state = this.isAuditorState();
    return state !== null && state.uid === this.projectUid() ? state.isAuditor : false;
  });

  private readonly sfidState: Signal<{ uid: string; sfid: string | null } | null> = this.initSfidState();
  protected readonly sfid: Signal<string | null> = computed(() => {
    const state = this.sfidState();
    return state !== null && state.uid === this.projectUid() ? state.sfid : null;
  });

  protected readonly adminToolUrl: Signal<string> = this.initAdminToolUrl();

  /**
   * Input mode wins outright — no per-field fallback to `ProjectContextService`. See the class
   * doc: on the drill-down that service describes the parent foundation, so a mixed view-model
   * would pair the foundation's slug with the child's checklist.
   */
  private initView(): Signal<FormationCardView | null> {
    return computed(() => {
      const formation = this.formation();
      if (formation) {
        return {
          uid: formation.parent_project_uid ?? null,
          slug: formation.parent_project_slug,
          subStageLabel: getFormationSubStageLabel(formation.sub_stage_raw),
          announcementLabel: formatAnnouncementDateLabel(formation.announcement_date),
        };
      }

      const project = this.projectContextService.activeProject();
      if (!project) {
        return null;
      }
      return {
        uid: project.uid ?? null,
        slug: project.slug,
        subStageLabel: this.projectContextService.activeProjectFormationSubStage(),
        announcementLabel: formatAnnouncementDateLabel(this.projectContextService.activeProjectAnnouncementDate()),
      };
    });
  }

  // Dedicated `auditor` FGA check (GH-1955) — independent of `ProjectContextService.activeProject`,
  // which doesn't request this flag. `writer === true` is load-bearing, not redundant: the server
  // skips the auditor check entirely once a caller is already a writer (a strict superset of
  // access), so a writer's `auditor` field comes back `undefined` — without the OR, a project
  // writer would be wrongly denied this deep link.
  // No catchError here — ProjectService.getProject already resolves any HTTP failure to `null`
  // internally (logging as it does so), so `project?.writer`/`project?.auditor` on a failed fetch
  // are both `undefined`, and the map below already yields `false` for that case.
  private initIsAuditorState(): Signal<{ uid: string; isAuditor: boolean } | null> {
    return toSignal(
      toObservable(this.projectUid).pipe(
        filter((uid): uid is string => !!uid),
        switchMap((uid) =>
          this.projectService
            .getProject(uid, false, { auditor: true })
            .pipe(map((project) => ({ uid, isAuditor: project?.writer === true || project?.auditor === true })))
        )
      ),
      { initialValue: null }
    );
  }

  // Only fetched once `isAuditor()` resolves true — everyone else can never see the admin-tool link
  // this resolves for, so a non-auditor viewer shouldn't pay for the round trip.
  // `ProjectService.getProjectSfid` already logs and resolves to `null` on failure — no additional
  // catchError needed here.
  private initSfidState(): Signal<{ uid: string; sfid: string | null } | null> {
    return toSignal(
      toObservable(computed(() => (this.isAuditor() ? this.projectUid() : null))).pipe(
        filter((uid): uid is string => !!uid),
        switchMap((uid) => this.projectService.getProjectSfid(uid).pipe(map((sfid) => ({ uid, sfid }))))
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
