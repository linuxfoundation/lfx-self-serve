// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ORG_LENS_PRIVATE_RELEASE_FLAG } from '@lfx-one/shared/constants';
import type {
  OrgAllEmployeeDetail,
  OrgDrawerDetailResult,
  OrgPersonCompanyEmailsResponse,
  PersonDrawerContext,
  PersonDrawerTab,
} from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { FeatureFlagService } from '@services/feature-flag.service';
import { catchError, map, Observable, of, switchMap } from 'rxjs';

const NO_COMPANY_EMAILS: OrgPersonCompanyEmailsResponse = { companyEmails: [], companyEmailsStatus: 'unavailable' };

/** The person's API base: keyed on the warehouse personKey when the opener has one, else on the LF username (resolved server-side). */
function personPath(orgUid: string, context: PersonDrawerContext | null): string | null {
  const people = `/api/orgs/${encodeURIComponent(orgUid)}/lens/people`;
  if (context?.personKey) {
    return `${people}/${encodeURIComponent(context.personKey)}`;
  }
  return context?.username ? `${people}/by-username/${encodeURIComponent(context.username)}` : null;
}

/**
 * Cross-page open state + detail fetch for the shared person-detail drawer (LFXV2-2195). Activity and company
 * addresses are two independent requests: the address read is a live warehouse view that takes seconds, so the
 * drawer renders activity as soon as it arrives and fills in the address line when it lands.
 */
@Injectable({
  providedIn: 'root',
})
export class PersonDetailDrawerService {
  private readonly http = inject(HttpClient);
  private readonly accountContext = inject(AccountContextService);
  private readonly featureFlagService = inject(FeatureFlagService);

  private readonly companyEmailFeatureEnabled = this.featureFlagService.getBooleanFlag(ORG_LENS_PRIVATE_RELEASE_FLAG, false);

  private readonly _activeContext = signal<PersonDrawerContext | null>(null);
  public readonly activeContext = this._activeContext.asReadonly();

  private readonly _activeTab = signal<PersonDrawerTab>('events');
  public readonly activeTab = this._activeTab.asReadonly();

  private readonly orgUid = computed(() => this.accountContext.selectedAccount().uid);
  private readonly detailRequest = computed(() => ({ orgUid: this.orgUid(), context: this._activeContext() }));
  // The flag keys only the address request, so flipping it never refetches activity.
  private readonly emailsRequest = computed(() => ({ ...this.detailRequest(), companyEmailFeatureEnabled: this.companyEmailFeatureEnabled() }));
  public readonly isOpen = computed(() => this._activeContext() !== null);

  private readonly detailResult = toSignal(
    toObservable(this.detailRequest).pipe(
      switchMap((request): Observable<OrgDrawerDetailResult & { request: typeof request }> => {
        const path = request.orgUid ? personPath(request.orgUid, request.context) : null;
        if (!path) {
          return of({ request, detail: null, error: false });
        }
        return this.http.get<OrgAllEmployeeDetail | null>(`${path}/detail`).pipe(
          map((detail) => ({ request, detail, error: false })),
          catchError((err: unknown) => {
            console.error('Failed to load person detail:', err);
            return of({ request, detail: null, error: true });
          })
        );
      })
    ),
    { initialValue: null }
  );

  private readonly emailsResult = toSignal(
    toObservable(this.emailsRequest).pipe(
      switchMap((request): Observable<OrgPersonCompanyEmailsResponse & { request: typeof request }> => {
        const path = request.orgUid ? personPath(request.orgUid, request.context) : null;
        // Flag off (or nobody to look up): no address request at all.
        if (!path || !request.companyEmailFeatureEnabled) {
          return of({ request, ...NO_COMPANY_EMAILS });
        }
        // A live-only person resolves against the directory the opener showed, which the page has already warmed.
        const view = request.context?.directoryView;
        const params = view ? { range: view.range, projectScope: view.projectScope } : undefined;
        return this.http.get<OrgPersonCompanyEmailsResponse>(`${path}/company-emails`, { params }).pipe(
          // Only a resolved lookup may expose addresses; a missing status surfaces as an email error.
          map((response) => ({
            request,
            companyEmails: response.companyEmailsStatus === 'resolved' ? response.companyEmails : [],
            companyEmailsStatus: response.companyEmailsStatus,
          })),
          // A failed optional address lookup never turns into a detail error.
          catchError((emailError: unknown) => {
            console.error('Failed to load company emails:', emailError);
            return of({ request, companyEmails: [], companyEmailsStatus: 'failed' as const });
          })
        );
      })
    ),
    { initialValue: null }
  );

  // toObservable starts on the next effect flush and toSignal retains the last response until then;
  // match each whole request synchronously so nothing leaks to a newly opened person.
  private readonly currentDetail = computed(() => {
    const result = this.detailResult();
    return this._activeContext() && this.orgUid() && result?.request === this.detailRequest() ? result : null;
  });
  private readonly currentEmails = computed(() => {
    const result = this.emailsResult();
    return this._activeContext() && this.orgUid() && result?.request === this.emailsRequest() ? result : null;
  });

  public readonly loading = computed(() => {
    const { orgUid, context } = this.detailRequest();
    return !!(orgUid && context && (context.personKey || context.username) && !this.currentDetail());
  });
  public readonly error = computed(() => this.currentDetail()?.error ?? false);
  public readonly detail = computed<OrgAllEmployeeDetail | null>(() => this.currentDetail()?.detail ?? null);

  public readonly emailsLoading = computed(() => {
    const { orgUid, context, companyEmailFeatureEnabled } = this.emailsRequest();
    return !!(companyEmailFeatureEnabled && orgUid && context && (context.personKey || context.username) && !this.currentEmails());
  });
  public readonly emailError = computed(() => {
    const result = this.currentEmails();
    return !!result && result.companyEmailsStatus !== 'resolved' && result.companyEmailsStatus !== 'unavailable';
  });
  public readonly identityUnavailable = computed(() => this.currentEmails()?.companyEmailsStatus === 'unavailable');
  public readonly companyEmailsResolved = computed(() => this.currentEmails()?.companyEmailsStatus === 'resolved');
  public readonly companyEmails = computed<string[]>(() => this.currentEmails()?.companyEmails ?? NO_COMPANY_EMAILS.companyEmails);

  public open(context: PersonDrawerContext): void {
    this._activeTab.set(context.defaultTab ?? 'events');
    this._activeContext.set(context);
  }

  public close(): void {
    this._activeContext.set(null);
  }

  public setTab(tab: PersonDrawerTab): void {
    this._activeTab.set(tab);
  }
}
