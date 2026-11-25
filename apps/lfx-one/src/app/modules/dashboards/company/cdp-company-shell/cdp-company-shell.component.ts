// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, DestroyRef, inject, PLATFORM_ID, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterOutlet } from '@angular/router';
import { CDP_COMPANY_DEFAULT_SECTION, CDP_COMPANY_ID_PATTERN, CDP_COMPANY_ROUTE_PREFIX, CDP_COMPANY_SEARCH_TAG } from '@lfx-one/shared/constants';
import type {
  CdpCompanyPage,
  CdpCompanyRedirectTarget,
  CdpCompanyResponse,
  CdpCompanyShellView,
  CdpSectionKey,
  OrgLensEmptyStateName,
  OrgLensEmptyStateValues,
} from '@lfx-one/shared/interfaces';
import { isOrgAccountIdSegment, isOrgSlugSegment, normalizeOrgSegment } from '@lfx-one/shared/utils';
import { OrgLensEmptyStateComponent } from '@components/org-lens-empty-state/org-lens-empty-state.component';
import { CdpCompanyContextService } from '@services/cdp-company-context.service';
import { CdpCompanyService } from '@services/cdp-company.service';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, combineLatest, map, Observable, of, startWith, switchMap, take, tap } from 'rxjs';

import { cdpCompanyShellEmptyState, classifyCdpPageError, formatCdpCompanyMonth, isCdpSectionKey } from '../cdp-company.util';

const LOADING: CdpCompanyShellView = { state: 'loading', page: null };
const NO_COMPANY: CdpCompanyShellView = { state: 'no-company', page: null };

/**
 * The CDP company page, `/company/{CDP id}/{section}` (lfx-self-serve#2092): reads the page once per id
 * and renders its outcome in place, at the address the viewer opened.
 *
 * - An outsider (availability not `available`), an unknown id and a malformed id all render "no company at this
 *   address", naming neither the id nor any company. A malformed id is never sent to the server.
 * - A failed audience check renders "could not verify".
 * - A merged id moves to its surviving CDP id on the same section; a B2B-linked id moves to that company's Company
 *   Lens home. Both replace the address.
 * - A company below the search rule renders its low-activity state with no counts and no section.
 * - Otherwise the company header and the routed section. Counts and labels only: no edit, invite, permission or
 *   settings control, and no way into the B2B Profile editor.
 *
 * The id never becomes the selected B2B company: it is held only by `CdpCompanyContextService` for the navigation.
 * Server-side rendering has no audience answer, so it renders the skeleton and the browser run decides.
 */
@Component({
  selector: 'lfx-cdp-company-shell',
  imports: [RouterOutlet, OrgLensEmptyStateComponent, SkeletonModule],
  templateUrl: './cdp-company-shell.component.html',
})
export class CdpCompanyShellComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly cdpCompanyService = inject(CdpCompanyService);
  private readonly context = inject(CdpCompanyContextService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly destroyRef = inject(DestroyRef);

  protected readonly cdpTag = CDP_COMPANY_SEARCH_TAG;

  private readonly attempt = signal(0);
  /** A broken logo falls back to the placeholder tile. */
  protected readonly logoFailed = signal(false);
  private enteredId: string | null = null;

  private readonly cdpId: Signal<string> = toSignal(this.route.paramMap.pipe(map((params) => params.get('cdpId') ?? '')), {
    initialValue: this.route.snapshot.paramMap.get('cdpId') ?? '',
  });
  protected readonly view: Signal<CdpCompanyShellView> = this.initView();
  protected readonly state = computed(() => this.view().state);
  protected readonly company = computed(() => this.view().page?.company ?? null);
  protected readonly emptyState: Signal<OrgLensEmptyStateName | null> = computed(() => cdpCompanyShellEmptyState(this.state()));
  protected readonly lastActive: Signal<string | null> = computed(() => formatCdpCompanyMonth(this.company()?.lastActiveMonth));
  protected readonly emptyStateValues: Signal<OrgLensEmptyStateValues> = computed(() => ({ lastActive: this.lastActive() }));
  protected readonly logoUrl: Signal<string | null> = computed(() => (this.logoFailed() ? null : (this.company()?.logoUrl ?? null)));

  public constructor() {
    // Entered synchronously from the route param, before the first render and on the server too: the async `load`
    // runs only after the first change detection, and until then an empty context would let the Company Lens
    // navigation fall back to the selected B2B company's items for a moment.
    this.enteredId = this.cdpId();
    this.context.enter(this.enteredId);
    this.destroyRef.onDestroy(() => {
      if (this.enteredId !== null) this.context.leave(this.enteredId);
    });
  }

  /** Re-asks the audience and the page after a failed check or read. */
  protected retry(): void {
    this.attempt.update((attempt) => attempt + 1);
  }

  private initView(): Signal<CdpCompanyShellView> {
    return toSignal(combineLatest([toObservable(this.cdpId), toObservable(this.attempt)]).pipe(switchMap(([cdpId]) => this.load(cdpId))), {
      initialValue: LOADING,
    });
  }

  private load(cdpId: string): Observable<CdpCompanyShellView> {
    if (!this.isBrowser) return of(LOADING);
    this.enteredId = cdpId;
    this.context.enter(cdpId);
    this.logoFailed.set(false);
    // Malformed (any id that is not a lowercase crowd.dev UUID): answered here exactly as an unknown id, never sent.
    if (!CDP_COMPANY_ID_PATTERN.test(cdpId)) return of(this.settle(cdpId, NO_COMPANY));
    return this.cdpCompanyService.availability().pipe(
      take(1),
      switchMap((audience): Observable<CdpCompanyShellView> => {
        if (audience === 'unverifiable') return of({ state: 'could-not-verify', page: null });
        if (audience !== 'available') return of(NO_COMPANY);
        return this.cdpCompanyService.getCompany(cdpId).pipe(
          switchMap((response) => this.fromResponse(response)),
          catchError((error: unknown) => of<CdpCompanyShellView>({ state: classifyCdpPageError(error), page: null }))
        );
      }),
      tap((view) => {
        if (view.state !== 'loading') this.settle(cdpId, view);
      }),
      startWith(LOADING)
    );
  }

  private fromResponse(response: CdpCompanyResponse): Observable<CdpCompanyShellView> {
    if ('redirect' in response) return this.followRedirect(response.redirect);
    return of(this.fromPage(response));
  }

  private fromPage(page: CdpCompanyPage): CdpCompanyShellView {
    switch (page.state) {
      case 'ok':
        return { state: 'ok', page };
      case 'no-activity':
        return { state: 'low-activity-none', page };
      case 'not-enough-activity':
        return { state: 'low-activity-not-enough', page };
      default:
        return { state: 'could-not-load', page: null };
    }
  }

  /**
   * One step to the final address, replacing the old one in history. A target that is not a well-formed
   * address is treated as no company rather than followed.
   */
  private followRedirect(redirect: CdpCompanyRedirectTarget): Observable<CdpCompanyShellView> {
    const target = typeof redirect.target === 'string' ? redirect.target : '';
    const segment = normalizeOrgSegment(target);
    let commands: string[] | null = null;
    if (redirect.kind === 'cdp' && CDP_COMPANY_ID_PATTERN.test(target)) {
      commands = [`/${CDP_COMPANY_ROUTE_PREFIX}`, target, this.currentSection()];
    } else if (redirect.kind === 'b2b' && (isOrgSlugSegment(segment) || isOrgAccountIdSegment(segment))) {
      commands = [`/${CDP_COMPANY_ROUTE_PREFIX}`, segment];
    }
    if (!commands) return of(NO_COMPANY);
    void this.router.navigate(commands, { replaceUrl: true });
    return of(LOADING);
  }

  /** The section on screen, so a merge redirect keeps it. */
  private currentSection(): CdpSectionKey {
    const section = this.route.snapshot.firstChild?.routeConfig?.path;
    return isCdpSectionKey(section) ? section : CDP_COMPANY_DEFAULT_SECTION;
  }

  private settle(cdpId: string, view: CdpCompanyShellView): CdpCompanyShellView {
    this.context.settle(cdpId, view.page);
    return view;
  }
}
