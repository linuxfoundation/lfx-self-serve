// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, inject, Injectable, Injector, Signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { Account, OrgItem } from '@lfx-one/shared/interfaces';
import { combineLatest, filter, map, Observable, of, shareReplay, skip, switchMap, take } from 'rxjs';

import { AccountContextService } from './account-context.service';
import { OrgNavigationService } from './org-navigation.service';
import { OrgRoleGrantsService } from './org-role-grants.service';
import { PersonaService } from './persona.service';

/**
 * Resolves and selects the organization EasyCLA names on a corporate-signing return address.
 *
 * Both EasyCLA return destinations need this — the CLA Group detail a new trip lands on (#2352),
 * and the list an envelope minted before that still points at — and they must agree on what the
 * parameter is allowed to do. Holding it in one service is what makes "names but does not grant"
 * a single implementation rather than a convention two components separately honour.
 */
@Injectable({ providedIn: 'root' })
export class OrgClaReturnService {
  private readonly accountContext = inject(AccountContextService);
  private readonly orgNavigation = inject(OrgNavigationService);
  private readonly orgRoleGrants = inject(OrgRoleGrantsService);
  private readonly personaService = inject(PersonaService);
  private readonly injector = inject(Injector);

  private readonly resolutions = new Map<string, Observable<Account | null>>();

  /**
   * True once both grant fetches have returned and the caller holds no org access.
   *
   * Shares `hasOrgSelectorAccess` with the sidebar org-selector so the two cannot drift, and waits
   * on `personaLoaded()` as well: for users whose orgs arrive only via the async personas
   * response, role grants can return empty first, which would read as a settled no-access answer
   * while the catalogue is still on its way.
   */
  private readonly hasNoOrgAccess: Signal<boolean> = computed(
    () => this.orgRoleGrants.loaded() && this.personaService.personaLoaded() && !this.accountContext.hasOrgSelectorAccess()
  );

  /**
   * Selects the named organization when the viewer holds it, and reports what was resolved.
   *
   * The signatory comes back through a cross-site navigation, and which organization is selected
   * survives that only in a `SameSite=Lax` cookie. When it does not come back, bootstrap falls to
   * the first organization in the viewer's list — so signing for one company returns them looking
   * at another, with their new agreement nowhere in sight.
   *
   * `setAccount` also rewrites the cookie, so the round trip repairs the selection that went
   * missing rather than leaving the next reload to fall back all over again. The catalogue row is
   * the same indexed snapshot the selector uses; `refreshCanonicalRecord` is the fire-and-forget
   * reconciliation both `org-selector` and `org-navigation` run after `setAccount`, so this does
   * not leave name, logo and parent stale for the rest of the session.
   *
   * Emits null when the catalogue does not hold the name, and selects nothing in that case.
   */
  public adopt(named: string): Observable<Account | null> {
    return this.organizationNamed(named).pipe(
      map((match) => {
        if (match) {
          this.accountContext.setAccount(match);
          this.accountContext.refreshCanonicalRecord(match).catch(() => {
            // Errors are already logged inside refreshCanonicalRecord.
          });
        }
        return match;
      })
    );
  }

  /**
   * The resolution for one name, shared between every caller on this page load.
   *
   * Cached because a page may both adopt the organization and wait on the same answer before
   * deciding where the viewer ends up, and `resolveNamedOrganization` can reload the catalogue —
   * two independent subscriptions would reload it twice and race each other's answer.
   */
  public organizationNamed(named: string): Observable<Account | null> {
    const cached = this.resolutions.get(named);
    if (cached) return cached;

    const resolution = this.resolveNamedOrganization(named).pipe(shareReplay({ bufferSize: 1, refCount: false }));
    this.resolutions.set(named, resolution);
    return resolution;
  }

  /**
   * Resolves the named organization against the access-aware catalogue, or null.
   *
   * Two-pass: wait until the catalogue has loaded, or until no-access is a settled miss — a
   * no-access viewer never boots the catalogue, so waiting on `loaded` would hang. An immediate
   * match is returned as-is. Only when the named organization is absent does this pin and reload
   * (`resetAndReload`), then skip the current emission and wait for the next loaded one before
   * matching again. Dropping `skip(1)` would re-match the stale pre-reload list and treat a
   * not-yet-listed organization as a miss.
   *
   * Ask is not a grant: the second pass still only selects what the catalogue returns.
   */
  private resolveNamedOrganization(named: string): Observable<Account | null> {
    // A caller may reach this from a component constructor or from a later event, so the injector
    // is passed rather than relying on an ambient injection context.
    const items$ = toObservable(this.orgNavigation.items, { injector: this.injector });
    const loaded$ = toObservable(this.orgNavigation.loaded, { injector: this.injector });
    const noAccess$ = toObservable(this.hasNoOrgAccess, { injector: this.injector });

    return combineLatest([items$, loaded$, noAccess$]).pipe(
      filter(([, loaded, noAccess]) => noAccess || loaded),
      take(1),
      switchMap(([items, , noAccess]) => {
        if (noAccess) return of(null);
        const immediate = this.catalogueAccountNamed(items, named);
        if (immediate) return of(immediate);
        this.orgNavigation.resetAndReload(named);
        return combineLatest([items$, loaded$]).pipe(
          skip(1),
          filter(([, loaded]) => loaded),
          map(([current]) => this.catalogueAccountNamed(current, named)),
          take(1)
        );
      })
    );
  }

  /**
   * The viewer's own account for the organization named on the return address, or null.
   *
   * Resolved on either identifier the catalogue row may carry. Spec 002 treats `uid` and
   * `accountId` as the same Salesforce id, but `accountId` is still nullable for pre-spec-002
   * callers, and the return address may name either field. Matching on `uid` alone would miss a
   * row that only populated `accountId`, and the company the signatory has just signed for would
   * read as one they do not hold.
   *
   * `uid` is pinned onto the result because `setAccount` keys the selection and the cookie by it,
   * and clears the cookie outright when it is absent.
   *
   * Still only a resolution, never a grant: an organization that is not in this list is not
   * matched, so a crafted address selects nothing.
   */
  private catalogueAccountNamed(items: OrgItem[], named: string): Account | null {
    const match = items.find((item: OrgItem) => item.uid === named || item.accountId === named);
    if (!match) return null;
    return {
      accountId: match.accountId ?? named,
      accountName: match.name,
      accountSlug: '',
      membershipTier: '',
      logoUrl: match.logoUrl ?? null,
      uid: named,
    };
  }
}
