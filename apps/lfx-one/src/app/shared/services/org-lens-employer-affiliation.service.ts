// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { computed, inject, Injectable, signal, Signal, WritableSignal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ORG_AFFILIATION_LOOKUP_TIMEOUT_MS } from '@lfx-one/shared/constants';
import { OrgLensEmployerAffiliation } from '@lfx-one/shared/interfaces';
import { catchError, distinctUntilChanged, filter, map, Observable, of, scan, startWith, switchMap, take, timeout } from 'rxjs';

import { AccountContextService } from './account-context.service';
import { OrgRoleGrantsService } from './org-role-grants.service';
import { UserService } from './user.service';

/** An answer from the probe; `failed` when the request did not land. */
type AffiliationAnswer = { status: 'answered'; affiliation: OrgLensEmployerAffiliation } | { status: 'failed' };

/**
 * The probe's state. `answer` is the last one that landed and is held across a re-ask, so a question
 * asked again — the shared Retry, or a work-history edit — leaves the state it produced on screen
 * instead of pulling the page back to a skeleton; `inFlight` says a request is out for `key`.
 */
interface AffiliationProbe { key: string | null; answer: AffiliationAnswer | null; inFlight: boolean }

/**
 * #4314 — the caller's own employer and whether it is an LF member, for the Org Lens empty states.
 *
 * Only ever asked for the callers who need it: once the role-grants lookup has answered and the caller
 * holds nothing, which is exactly the population that lands on an empty state instead of a page. Staff
 * and anyone with a grant never trigger the request.
 *
 * Nothing here decides a state — `OrgLensEmptyStateService` does. This service only answers "who do
 * they work for" and "is that company a member", and says plainly when it could not find out
 * (`lookupFailed`), because an unknown must never render as "your employer is not a member".
 */
@Injectable({
  providedIn: 'root',
})
export class OrgLensEmployerAffiliationService {
  private readonly http = inject(HttpClient);
  private readonly accountContext = inject(AccountContextService);
  private readonly roleGrants = inject(OrgRoleGrantsService);
  private readonly userService = inject(UserService);

  /** Bumped by {@link refresh} to re-ask the same question (the shared Retry). */
  private readonly refreshCount: WritableSignal<number> = signal(0);

  /**
   * The caller is in the population this question is about: the grants lookup has answered, they are
   * not staff, and they hold no organization. Anything else leaves the probe idle and silent.
   */
  private readonly inPopulation: Signal<boolean> = computed(
    () => this.roleGrants.loaded() && !this.roleGrants.isStaff() && !this.accountContext.hasOrgSelectorAccess()
  );

  /**
   * …and #4225 has not already answered for them. Rule 6 of the classifier asks that verdict first, so
   * for a caller whose employer is a known LF member this probe's answer is never read — asking anyway
   * would spend a CDP round trip and a Snowflake query on wording that is already decided.
   */
  private readonly needed: Signal<boolean> = computed(() => this.inPopulation() && !this.roleGrants.affiliatedToMember());

  /**
   * Opens on the first tick where the caller is in the population, so an edit made before the grants
   * lookup has answered waits for it instead of being dropped. Re-subscribed per edit; it never emits
   * for staff or for anyone holding an organization, who have no verdict worth re-asking.
   */
  private readonly inPopulationReached: Observable<boolean> = toObservable(this.inPopulation).pipe(
    filter((inPopulation) => inPopulation),
    take(1)
  );

  /**
   * #4225's verdict is derived from the same work history as this probe, but it rides the role-grants
   * response and is cached server-side. The classifier reads it before anything here, so an edit that
   * replaces a member employer with a non-member one would otherwise keep answering `affiliated-no-grant`
   * from the stale verdict and never reach the state this service exists to render. Re-ask it — cache
   * bypassed — on the same revision the probe keys off.
   *
   * A subscription rather than an `effect()`: this is state-changing work, which the frontend checklist
   * reserves `effect()` against (`docs/architecture/frontend/state-management.md`, "Signal-to-RxJS State
   * Bridges"). `switchMap` also means a second edit supersedes one still waiting on the population.
   */
  private readonly memberVerdictInvalidation = toObservable(this.userService.workExperienceRevision)
    .pipe(
      // 0 is the seed, not an edit: the initial grants load has already asked.
      filter((revision) => revision > 0),
      switchMap(() => this.inPopulationReached),
      switchMap(() => this.roleGrants.refresh(true)),
      takeUntilDestroyed()
    )
    .subscribe();

  /**
   * What the probe is asking about: `null` when nothing should be asked, otherwise a key that changes
   * whenever the answer could have. The caller's own work history is in it, so following the state's
   * "Update employer affiliation" CTA and coming back re-asks instead of repeating the stale answer —
   * a root-provided service outlives that round trip.
   */
  private readonly probeKey: Signal<string | null> = computed(() =>
    this.needed() ? `${this.userService.workExperienceRevision()}:${this.refreshCount()}` : null
  );

  private readonly probe: Signal<AffiliationProbe> = toSignal(
    toObservable(this.probeKey).pipe(
      distinctUntilChanged(),
      switchMap(
        (key): Observable<AffiliationProbe> =>
          key === null
            ? of<AffiliationProbe>({ key: null, answer: null, inFlight: false })
            : this.fetch().pipe(
                map((answer): AffiliationProbe => ({ key, answer, inFlight: false })),
                startWith<AffiliationProbe>({ key, answer: null, inFlight: true })
              )
      ),
      // Carry the previous answer through a re-ask. Without this, Retry on the employer outage
      // replaces that state — and the Retry control inside it — with a skeleton until the new answer
      // lands, and `could-not-load` momentarily reads as `no-organization` on the way.
      scan((previous, next) => (next.inFlight && previous.answer !== null ? { ...next, answer: previous.answer } : next))
    ),
    { initialValue: { key: null, answer: null, inFlight: false } as AffiliationProbe }
  );

  /**
   * The probe is owed an answer and has not given one — hold the page on its skeleton until it has.
   *
   * Anything that is not an answer counts, `idle` included: `toObservable` drives the probe from an
   * effect, so between `needed` turning true and that effect running the probe is still `idle`. Reading
   * that as settled would let `no-organization` — the "add an affiliation" copy this state exists to
   * replace — render for a tick before the skeleton.
   */
  public readonly pending: Signal<boolean> = computed(() => this.needed() && this.probe().answer === null);

  /**
   * A re-ask is out and a previous answer is still on screen — the shared Retry's employer half.
   * Distinct from {@link pending}, which is the first answer and holds the page on its skeleton:
   * here the state is already rendered, so the Retry control binds to this and stays put.
   */
  public readonly refreshing: Signal<boolean> = computed(() => {
    const probe = this.probe();
    return this.needed() && probe.answer !== null && probe.inFlight;
  });

  /** The request did not land, so "no membership" is unknown rather than false. */
  public readonly lookupFailed: Signal<boolean> = computed(() => this.needed() && this.probe().answer?.status === 'failed');

  /** The caller's current employer from their own profile; `null` when they have none, or nothing was asked. */
  public readonly employerName: Signal<string | null> = computed(() => {
    const answer = this.probe().answer;
    return answer?.status === 'answered' ? answer.affiliation.employerName : null;
  });

  /**
   * A *checked* "this caller is affiliated with a company that holds no active LF membership". False
   * while the answer is missing, failed, `unresolved` (the employer did not match an account, so its
   * membership was never established), or the caller has no employer at all — every case that must
   * not render copy stating a company is not a member.
   */
  public readonly affiliatedToNonMember: Signal<boolean> = computed(() => {
    const answer = this.probe().answer;
    return answer?.status === 'answered' && !!answer.affiliation.employerName && answer.affiliation.membership === 'non-member';
  });

  /**
   * A *checked* "this caller's employer IS an LF member", from this probe rather than #4225's verdict.
   *
   * The two are refreshed separately after a work-history edit, and this one usually lands first, so
   * rule 6 has to accept either. Without it a caller who has just affiliated with a member company
   * falls past rule 6 (whose verdict is still the pre-edit one) and past rule 7 (this probe says
   * `member`, not `non-member`) into `no-organization` — told to add the affiliation they have just
   * added, which is the loop #4314 exists to close.
   */
  public readonly affiliatedToMember: Signal<boolean> = computed(() => {
    const answer = this.probe().answer;
    return answer?.status === 'answered' && !!answer.affiliation.employerName && answer.affiliation.membership === 'member';
  });

  /** Re-ask the question — the shared Retry's employer half. */
  public refresh(): void {
    this.refreshCount.update((count) => count + 1);
  }

  private fetch(): Observable<AffiliationAnswer> {
    return this.http.get<OrgLensEmployerAffiliation>('/api/profile/employer-affiliation').pipe(
      // `settled` holds the page on its skeleton until this answers, so an answer that never comes —
      // a hung warehouse read, a dropped socket — would strand every grant-less caller there with no
      // Retry to reach. Bounded by the same budget #4225 gives its sibling lookup; a timeout is a
      // failed lookup, which renders `could-not-load` and its Retry rather than a silent skeleton.
      timeout(ORG_AFFILIATION_LOOKUP_TIMEOUT_MS),
      map((affiliation): AffiliationAnswer => ({ status: 'answered', affiliation })),
      catchError((error) => {
        console.warn('[OrgLensEmployerAffiliationService] employer affiliation lookup failed', error);
        return of<AffiliationAnswer>({ status: 'failed' });
      })
    );
  }
}
