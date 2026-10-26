// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { computed, inject, Injectable, Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { OrgLensEmployerAffiliation } from '@lfx-one/shared/interfaces';
import { catchError, map, Observable, of, startWith, switchMap } from 'rxjs';
import { toObservable } from '@angular/core/rxjs-interop';

import { AccountContextService } from './account-context.service';
import { OrgRoleGrantsService } from './org-role-grants.service';

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

  /**
   * The caller is in the population this question is about: the grants lookup has answered, they are
   * not staff, and they hold no organization. Anything else leaves the probe idle and silent.
   */
  private readonly needed: Signal<boolean> = computed(
    () => this.roleGrants.loaded() && !this.roleGrants.isStaff() && !this.accountContext.hasOrgSelectorAccess()
  );

  private readonly probe: Signal<AffiliationProbe> = toSignal(
    toObservable(this.needed).pipe(
      switchMap(
        (needed): Observable<AffiliationProbe> =>
          needed ? this.fetch().pipe(startWith<AffiliationProbe>({ status: 'pending' })) : of<AffiliationProbe>({ status: 'idle' })
      )
    ),
    { initialValue: { status: 'idle' } as AffiliationProbe }
  );

  /** The probe is owed an answer and has not given one — hold the page on its skeleton until it has. */
  public readonly pending: Signal<boolean> = computed(() => this.needed() && this.probe().status === 'pending');

  /** The request did not land, so "no membership" is unknown rather than false. */
  public readonly lookupFailed: Signal<boolean> = computed(() => this.probe().status === 'failed');

  /** The caller's current employer from their own profile; `null` when they have none, or nothing was asked. */
  public readonly employerName: Signal<string | null> = computed(() => {
    const probe = this.probe();
    return probe.status === 'answered' ? probe.affiliation.employerName : null;
  });

  /**
   * A resolved "this caller is affiliated with a company that holds no active LF membership". False
   * while the answer is missing, failed, or the caller has no employer at all — the three cases that
   * must not render the non-member copy.
   */
  public readonly affiliatedToNonMember: Signal<boolean> = computed(() => {
    const probe = this.probe();
    return probe.status === 'answered' && !!probe.affiliation.employerName && !probe.affiliation.hasActiveMembership;
  });

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
