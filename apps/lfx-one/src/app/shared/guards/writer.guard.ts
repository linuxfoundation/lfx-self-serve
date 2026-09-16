// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT
import { COMMITTEE_WRITE_FEATURES } from '@lfx-one/shared/constants';
import type { EntityWithProject } from '@lfx-one/shared/interfaces';
import { HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Router } from '@angular/router';
import { catchError, map, Observable, of, switchMap } from 'rxjs';

import { CommitteeService } from '../services/committee.service';
import { MailingListService } from '../services/mailing-list.service';
import { MeetingService } from '../services/meeting.service';
import { PersonaService } from '../services/persona.service';
import { ProjectContextService } from '../services/project-context.service';
import { ProjectService } from '../services/project.service';
import { SurveyService } from '../services/survey.service';
import { VoteService } from '../services/vote.service';
import { isTransientHttpError, retryTransientHttpError } from '../utils/http-error.utils';
import { hasMeetingWriteAccess, resolveEntityWriteSlug } from '../utils/write-access.util';

/**
 * Protects create/edit/admin routes that require project write permission.
 *
 * Fast path: ED persona is synchronously allowed (cookie-seeded, no HTTP round-trip).
 * Slow path: evaluates write permission in priority order:
 *
 * 1. `project.writer` — project owner, writer, or inherited parent-project writer.
 * 2. `project.meetingCoordinator` — meeting_coordinator role on the project; accepted
 *    only for routes with `data.writeFeature === 'meetings'`.
 * 3. `committee.writer` — committee writer; accepted only when `writeFeature` is one of
 *    `'meetings'`, `'surveys'`, or `'votes'` and a committee uid is available — from the probed
 *    entity itself when its probe surfaces one (the votes and surveys probes carry
 *    `committee_uid`; the meetings probe falls through to the URL param), else from the
 *    `committee_uid` query param (create routes; attacker-controlled, which is why the entity
 *    value wins when present). The backend ruleset allows committee:uid#writer to create
 *    resources associated with their committee.
 *
 * Slug resolution: on routes flagged `data.entityScopedSlug` (meeting/group/mailing-list/vote/survey edit), resolves
 * the slug from the entity itself first — the active context can belong to a different project
 * when the edit link carried no `?project=`. A non-404 failure on that read resolves no slug at all,
 * so the guard redirects instead of authorizing against a stale context; a flagged route with no
 * registered probe or `:id` param is misconfigured and likewise fails closed. Otherwise prefers the `?project=` query param
 * (authoritative for the navigation target, works before the lens has synced), then falls back
 * to the active context's slug. The flag lives in route data — not a routeConfig.path check — so
 * a route rename/restructure can't silently disable the entity-scoped resolution.
 * Redirects to the lens-appropriate overview on denial so the correct project context is
 * preserved and NavigationService.applyDefaultSelection does not override the selection.
 *
 * On denial, encodes `_notice=<writeFeature>` in the redirect URL instead of calling
 * MessageService directly. AppComponent detects `_notice` on NavigationEnd, shows the
 * contextual "Access Denied" toast, and strips the param via Location.replaceState. This
 * two-step approach works for both SPA navigation and full-page-load (SSR) scenarios where
 * MessageService.add() on the server has no client-side effect.
 * A transient fetch failure (status 0/408/429/5xx, per isTransientHttpError) is retried once
 * via retryTransientHttpError; if it still fails, the redirect carries `_notice=error` instead —
 * AppComponent shows a "couldn't verify access, try again" error toast, so a server blip is
 * never silent and never misreported as a permission denial. The one non-HTTP signal in that
 * class: the BFF omits `meetingCoordinator` (HTTP 200, field undefined) when its coordinator FGA
 * check fails — on the deny paths that means "unknown", so it classifies as `_notice=error` too.
 *
 * When the project fetch fails (getProjectStrict propagates the HttpErrorResponse where
 * getProject collapsed it to null), the committee check is still attempted when a committee
 * uid is available — a committee writer may hold their role without a direct project-level
 * OpenFGA viewer relation. Only if that check also fails or is inapplicable does the guard
 * deny (`_notice=<writeFeature>`) or, on a transient failure, redirect with `_notice=error`.
 */
export const writerGuard: CanActivateFn = (route: ActivatedRouteSnapshot) => {
  const personaService = inject(PersonaService);
  const projectContextService = inject(ProjectContextService);
  const projectService = inject(ProjectService);
  const committeeService = inject(CommitteeService);
  const mailingListService = inject(MailingListService);
  const meetingService = inject(MeetingService);
  const surveyService = inject(SurveyService);
  const voteService = inject(VoteService);
  const router = inject(Router);

  if (personaService.currentPersona() === 'executive-director') {
    return true;
  }

  const committeeUid = route.queryParamMap.get('committee_uid') ?? null;

  const routeLens = route.parent?.data?.['lens'] ?? route.data?.['lens'];
  const overviewPath = routeLens === 'foundation' ? '/foundation/overview' : '/project/overview';

  // A missing/stale `?project=` can authorize against a different project than the entity being
  // edited — resolve the slug from the entity itself; only a 404 falls back, else fail closed.
  const writeFeature: string | undefined = route.data?.['writeFeature'];
  // Entity probes keyed by writeFeature — a new entity adds one registry line + the route's entityScopedSlug flag.
  // Probes must be tap-free so a guard probe can't leak stale state; a short-TTL detail cache, when present, is shared with the manage page.
  const entityProbes: Record<
    string,
    (id: string) => Observable<(Pick<EntityWithProject, 'project_slug' | 'project_uid'> & { committee_uid?: string }) | null>
  > = {
    meetings: (id) => meetingService.getMeetingDetail(id),
    committees: (id) => committeeService.fetchCommittee(id),
    votes: (id) => voteService.fetchVote(id),
    'mailing-lists': (id) => mailingListService.getMailingList(id),
    // Survey.project_uid is typed optional — map absent to '' so the probe satisfies the
    // registry's Pick<EntityWithProject> shape; resolveEntityWriteSlug treats '' as absent.
    // Honor the URL ?committee_uid= only when the survey's own committee list contains it (the
    // committee tab stamps the viewed committee, so from that path a writer of any associated
    // committee is admitted); otherwise fall back to the primary committee so an attacker-controlled param naming
    // an unrelated committee can't win — a committee-less project survey falls back to the URL param.
    // Known gap: the global surveys list stamps only committees[0] on edit links, so a writer of a
    // non-primary committee is fail-closed denied from the list and must edit via their committee
    // tab (iterating committees[] per row is follow-up work — GH-2190).
    surveys: (id) =>
      surveyService.getSurvey(id).pipe(
        map((survey) => ({
          project_slug: survey.project_slug,
          project_uid: survey.project_uid || '',
          committee_uid:
            committeeUid && survey.committees?.some((c) => c.committee_uid === committeeUid) ? committeeUid : survey.committees?.[0]?.committee_uid,
        }))
      ),
  };
  const resolveSlug = (): Observable<{ slug: string | null; entityCommitteeUid: string | null; failure?: 'transient' | 'denied' }> => {
    const fromContext = route.queryParamMap.get('project') ?? projectContextService.activeContext()?.slug ?? null;
    if (route.data?.['entityScopedSlug'] !== true) {
      return of({ slug: fromContext, entityCommitteeUid: null });
    }
    const probe = writeFeature ? entityProbes[writeFeature] : undefined;
    const entityId = route.paramMap.get('id');
    // A flagged route without a usable probe is misconfigured — fail closed rather than
    // authorize against a possibly stale context.
    if (!probe || !entityId) {
      return of({ slug: null, entityCommitteeUid: null });
    }
    // Resolve from the entity payload, never the active context — a readable entity with a stale
    // context would authorize against the wrong project; only a 404 falls back, else fail closed.
    // One transient retry; a persistent failure is classified so the redirect can say why.
    return probe(entityId).pipe(
      retryTransientHttpError(),
      map((entity) => ({ slug: resolveEntityWriteSlug(entity, fromContext), entityCommitteeUid: entity?.committee_uid ?? null })),
      catchError((error) => {
        if (error instanceof HttpErrorResponse && error.status === 404) {
          return of({ slug: fromContext, entityCommitteeUid: null });
        }
        return of({ slug: null, entityCommitteeUid: null, failure: isTransientHttpError(error) ? ('transient' as const) : ('denied' as const) });
      })
    );
  };

  return resolveSlug().pipe(
    switchMap(({ slug, entityCommitteeUid, failure }) => {
      // `project: null` would serialize as the literal string "null", so the param is spread
      // in only when a slug resolved — probe-leg failures redirect param-free, as before.
      const withNotice = (notice: string) => router.createUrlTree([overviewPath], { queryParams: { ...(slug ? { project: slug } : {}), _notice: notice } });
      const deny = () => withNotice(writeFeature ?? 'access');
      const transientErrorUrl = () => withNotice('error');

      if (!slug) {
        if (failure === 'transient') {
          return of(transientErrorUrl());
        }
        if (failure === 'denied') {
          return of(deny());
        }
        return of(router.parseUrl(overviewPath));
      }

      const supportsCommitteeWriter = writeFeature != null && COMMITTEE_WRITE_FEATURES.includes(writeFeature);

      // Committee writers can create entities for their committee via ?committee_uid=. On
      // entity-scoped edit routes the probed entity's own committee wins when the probe carries
      // one (the votes and surveys probes return committee_uid today) — a URL param naming an
      // unrelated committee must not admit its writer, and an absent param must not deny the
      // entity's real committee writer.
      const effectiveCommitteeUid = entityCommitteeUid ?? committeeUid;
      // getCommittee's tap() side effect is safe here: deny blocks navigation; allow overwrites.
      const checkCommittee = (): Observable<true | ReturnType<typeof deny>> =>
        committeeService.getCommittee(effectiveCommitteeUid!).pipe(
          retryTransientHttpError(),
          map((committee) => (committee?.writer === true ? (true as const) : deny())),
          catchError((error) => of(isTransientHttpError(error) ? transientErrorUrl() : deny()))
        );

      // getProjectStrict (not getProject): it propagates the HttpErrorResponse so a transient
      // BFF failure classifies as `_notice=error` instead of a mislabeled "Access Denied".
      return projectService.getProjectStrict(slug, { meetingCoordinator: writeFeature === 'meetings' }).pipe(
        retryTransientHttpError(),
        switchMap((project) => {
          if (project.writer === true) {
            return of(true as const);
          }
          // meeting_coordinator can create meetings but not other write features
          if (writeFeature === 'meetings' && hasMeetingWriteAccess(project)) {
            return of(true as const);
          }
          // The BFF omits meetingCoordinator (HTTP 200, field undefined) when its FGA check fails —
          // on the deny paths undefined means "unknown", so classify transient, not denial.
          const coordinatorUnknown = writeFeature === 'meetings' && project.meetingCoordinator === undefined;
          if (effectiveCommitteeUid && supportsCommitteeWriter) {
            return checkCommittee().pipe(map((result) => (result !== true && coordinatorUnknown ? transientErrorUrl() : result)));
          }
          return of(coordinatorUnknown ? transientErrorUrl() : deny());
        }),
        catchError((error) => {
          // A fetch failure is not a denial — still try the committee check so a committee
          // writer isn't denied on a BFF error; only then classify transient vs denial.
          if (effectiveCommitteeUid && supportsCommitteeWriter) {
            // The project leg went unverified — a committee "not a writer" verdict must not
            // surface as Access Denied when the project failure was transient.
            return checkCommittee().pipe(map((result) => (result !== true && isTransientHttpError(error) ? transientErrorUrl() : result)));
          }
          return of(isTransientHttpError(error) ? transientErrorUrl() : deny());
        })
      );
    })
  );
};
