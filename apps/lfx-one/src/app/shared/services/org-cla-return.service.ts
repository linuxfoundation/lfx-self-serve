// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, inject, Injectable, Injector, Signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { Account, OrgItem } from '@lfx-one/shared/interfaces';
import { filter, map, Observable, of, shareReplay, switchMap, take, timeout } from 'rxjs';

import { AccountContextService } from './account-context.service';
import { OrgClaOnlyAccessService } from './org-cla-only-access.service';
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
  /**
   * Hang-up for one catalogue pin-reload. Same 10s ceiling as `ORG_SEARCH_TIMEOUT_MS` (an org-list
   * HTTP call that must settle), and well below the 30s API gateway timeout. This is one shot, not
   * a per-attempt cap with retries.
   */
  private static readonly catalogueReloadTimeoutMs = 10_000;

  private readonly accountContext = inject(AccountContextService);
  private readonly claOnlyAccess = inject(OrgClaOnlyAccessService);
  private readonly orgNavigation = inject(OrgNavigationService);
  private readonly orgRoleGrants = inject(OrgRoleGrantsService);
  private readonly personaService = inject(PersonaService);
  private readonly injector = inject(Injector);

  private readonly resolutions = new Map<string, Observable<{ account: Account; claOnly: boolean } | null>>();

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
   * The catalogue's state read as one value. A first page sets its landed generation, then the
   * CLA-only pending flag, then its items, so observing each signal on its own can pair a new
   * landed generation with the old pending flag and the old list, and match against that.
   */
  private readonly catalogue = computed(() => ({
    items: this.orgNavigation.items(),
    loaded: this.orgNavigation.loaded(),
    claOnlyPending: this.orgNavigation.claOnlyPending(),
    landedGeneration: this.orgNavigation.firstPageLandedGeneration(),
    noAccess: this.hasNoOrgAccess(),
  }));

  /**
   * Selects the named organization when the viewer holds it, and reports what was resolved.
   *
   * The signatory comes back through a cross-site navigation, and which organization is selected
   * survives that only in a `SameSite=Lax` cookie. When it does not come back, bootstrap falls to
   * the first organization in the viewer's list — so signing for one company returns them looking
   * at another, with their new agreement nowhere in sight.
   *
   * `adoptFromAddress` also rewrites the cookie, so the round trip repairs the selection that went
   * missing rather than leaving the next reload to fall back all over again — and pins the
   * selection as the address's own (lfx-self-serve#2570): the return can resolve as soon as the org
   * list has loaded, before the persona refresh, and that refresh carries no seeds for a grant-only
   * viewer; unpinned, it would reset the returned organization to the placeholder mid-render. The
   * catalogue row is the same indexed snapshot the selector uses; `refreshCanonicalRecord` is the
   * fire-and-forget reconciliation both `org-selector` and `org-navigation` run after selecting, so
   * this does not leave name, logo and parent stale for the rest of the session.
   *
   * The row's CLA-only answer is recorded before adopting: the path guard skips the resolver for the
   * selected organization, so nothing else would give a CLA-only company its EasyCLA-only shell.
   *
   * Emits null when the catalogue does not hold the name, and selects nothing in that case.
   */
  public adopt(named: string): Observable<Account | null> {
    return this.resolution(named).pipe(
      map((match) => {
        if (!match) return null;
        this.claOnlyAccess.noteAddressed(named, match.claOnly);
        this.accountContext.adoptFromAddress(match.account);
        this.accountContext.refreshCanonicalRecord(match.account).catch(() => {
          // Errors are already logged inside refreshCanonicalRecord.
        });
        return match.account;
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
    return this.resolution(named).pipe(map((match) => match?.account ?? null));
  }

  private resolution(named: string): Observable<{ account: Account; claOnly: boolean } | null> {
    const cached = this.resolutions.get(named);
    if (cached) return cached;

    const resolution = this.resolveNamedOrganization(named).pipe(shareReplay({ bufferSize: 1, refCount: false }));
    this.resolutions.set(named, resolution);
    return resolution;
  }

  /**
   * Resolves the named organization against the access-aware catalogue, or null.
   *
   * Two-pass: wait until the catalogue has loaded with its CLA-only rows (M3: a grant holder's
   * arrive on a second request, after `loaded`), or until no-access is a settled miss — a
   * no-access viewer never boots the catalogue, so waiting on `loaded` would hang. An immediate
   * match is returned as-is. Only when the named organization is absent does this pin and reload
   * (`resetAndReload`), then wait for the reload's own first page and its CLA-only rows before
   * matching again. `loaded` stays true across a reload and the reload clears the CLA-only rows at
   * once, so waiting on either alone would re-match the stale pre-reload list and treat a
   * not-yet-listed organization as a miss. That second wait is bounded: a reload that never
   * re-emits resolves to null rather than leaving adopt() pending. The first wait for a loaded
   * catalogue or a settled no-access answer is not this bound.
   *
   * Ask is not a grant: the second pass still only selects what the catalogue returns.
   */
  private resolveNamedOrganization(named: string): Observable<{ account: Account; claOnly: boolean } | null> {
    // A caller may reach this from a component constructor or from a later event, so the injector
    // is passed rather than relying on an ambient injection context.
    const catalogue$ = toObservable(this.catalogue, { injector: this.injector });

    return catalogue$.pipe(
      filter(({ loaded, claOnlyPending, noAccess }) => noAccess || (loaded && !claOnlyPending)),
      take(1),
      switchMap(({ items, noAccess }) => {
        if (noAccess) return of(null);
        const immediate = this.catalogueAccountNamed(items, named);
        if (immediate) return of(immediate);
        this.orgNavigation.resetAndReload(named);
        const reloadGeneration = this.orgNavigation.generation();
        return catalogue$.pipe(
          filter(({ landedGeneration, claOnlyPending }) => landedGeneration >= reloadGeneration && !claOnlyPending),
          map(({ items: current }) => this.catalogueAccountNamed(current, named)),
          take(1),
          timeout({ first: OrgClaReturnService.catalogueReloadTimeoutMs, with: () => of(null) })
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
  private catalogueAccountNamed(items: OrgItem[], named: string): { account: Account; claOnly: boolean } | null {
    const match = items.find((item: OrgItem) => item.uid === named || item.accountId === named);
    if (!match) return null;
    return {
      account: {
        accountId: match.accountId ?? named,
        accountName: match.name,
        membershipTier: '',
        logoUrl: match.logoUrl ?? null,
        uid: named,
        slug: match.slug ?? null,
      },
      claOnly: match.claOnly === true,
    };
  }
}
