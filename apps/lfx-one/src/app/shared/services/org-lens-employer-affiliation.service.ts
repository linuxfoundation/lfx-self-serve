// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { computed, effect, inject, Injectable, signal, Signal, untracked, WritableSignal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { OrgLensEmployerAffiliation } from '@lfx-one/shared/interfaces';
import { catchError, distinctUntilChanged, map, Observable, of, startWith, switchMap } from 'rxjs';

import { AccountContextService } from './account-context.service';
import { OrgRoleGrantsService } from './org-role-grants.service';
import { UserService } from './user.service';

/** The probe's state: not needed, in flight, or an answer (`failed` when the request did not land). */
type AffiliationProbe = { status: 'idle' } | { status: 'pending' } | { status: 'answered'; affiliation: OrgLensEmployerAffiliation } | { status: 'failed' };

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
   * #4225's verdict is derived from the same work history as this probe, but it rides the role-grants
   * response and is cached server-side. The classifier reads it before anything here, so an edit that
   * replaces a member employer with a non-member one would otherwise keep answering `affiliated-no-grant`
   * from the stale verdict and never reach the state this service exists to render. Re-ask it — cache
   * bypassed — on the same revision the probe keys off.
   *
   * Only the revision is tracked: reading the population predicate here would re-run this effect on the
   * very signals `refresh` writes, which is a loop.
   */
  private readonly memberVerdictInvalidation = effect(() => {
    const revision = this.userService.workExperienceRevision();
    // 0 is the seed, not an edit: the initial grants load has already asked.
    if (revision === 0 || !untracked(() => this.inPopulation())) {
      return;
    }
    this.roleGrants.refresh(true).subscribe();
  });

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
          key === null ? of<AffiliationProbe>({ status: 'idle' }) : this.fetch().pipe(startWith<AffiliationProbe>({ status: 'pending' }))
      )
    ),
    { initialValue: { status: 'idle' } as AffiliationProbe }
  );

  /**
   * The probe is owed an answer and has not given one — hold the page on its skeleton until it has.
   *
   * Anything that is not an answer counts, `idle` included: `toObservable` drives the probe from an
   * effect, so between `needed` turning true and that effect running the probe is still `idle`. Reading
   * that as settled would let `no-organization` — the "add an affiliation" copy this state exists to
   * replace — render for a tick before the skeleton.
   */
  public readonly pending: Signal<boolean> = computed(() => {
    if (!this.needed()) {
      return false;
    }
    const status = this.probe().status;
    return status !== 'answered' && status !== 'failed';
  });

  /** The request did not land, so "no membership" is unknown rather than false. */
  public readonly lookupFailed: Signal<boolean> = computed(() => this.needed() && this.probe().status === 'failed');

  /** The caller's current employer from their own profile; `null` when they have none, or nothing was asked. */
  public readonly employerName: Signal<string | null> = computed(() => {
    const probe = this.probe();
    return probe.status === 'answered' ? probe.affiliation.employerName : null;
  });

  /**
   * A *checked* "this caller is affiliated with a company that holds no active LF membership". False
   * while the answer is missing, failed, `unresolved` (the employer did not match an account, so its
   * membership was never established), or the caller has no employer at all — every case that must
   * not render copy stating a company is not a member.
   */
  public readonly affiliatedToNonMember: Signal<boolean> = computed(() => {
    const probe = this.probe();
    return probe.status === 'answered' && !!probe.affiliation.employerName && probe.affiliation.membership === 'non-member';
  });

  /** Re-ask the question — the shared Retry's employer half. */
  public refresh(): void {
    this.refreshCount.update((count) => count + 1);
  }

  private fetch(): Observable<AffiliationProbe> {
    return this.http.get<OrgLensEmployerAffiliation>('/api/profile/employer-affiliation').pipe(
      map((affiliation): AffiliationProbe => ({ status: 'answered', affiliation })),
      catchError((error) => {
        console.warn('[OrgLensEmployerAffiliationService] employer affiliation lookup failed', error);
        return of<AffiliationProbe>({ status: 'failed' });
      })
    );
  }
}
