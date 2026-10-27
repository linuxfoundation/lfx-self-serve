// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import type {
  OrgAllEmployeeDetail,
  OrgDrawerDetailResult,
  OrgPersonCompanyEmailsResponse,
  PersonDrawerContext,
  PersonDrawerTab,
} from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { catchError, map, Observable, of, switchMap } from 'rxjs';

const NO_COMPANY_EMAILS: OrgPersonCompanyEmailsResponse = { companyEmails: [], primaryEmail: null, companyEmailsStatus: 'unavailable' };

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

  private readonly _activeContext = signal<PersonDrawerContext | null>(null);
  public readonly activeContext = this._activeContext.asReadonly();

  private readonly _activeTab = signal<PersonDrawerTab>('events');
  public readonly activeTab = this._activeTab.asReadonly();

  public readonly orgUid = computed(() => this.accountContext.selectedAccount().uid);
  // Activity and addresses are two requests off the same key, so neither waits on the other.
  private readonly detailRequest = computed(() => ({ orgUid: this.orgUid(), context: this._activeContext() }));
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
    toObservable(this.detailRequest).pipe(
      switchMap((request): Observable<OrgPersonCompanyEmailsResponse & { request: typeof request }> => {
        const path = request.orgUid ? personPath(request.orgUid, request.context) : null;
        // Nobody to look up: no address request at all.
        if (!path) {
          return of({ request, ...NO_COMPANY_EMAILS });
        }
        return this.http.get<OrgPersonCompanyEmailsResponse>(`${path}/company-emails`).pipe(
          // Only a resolved lookup may expose addresses; a missing status surfaces as an email error.
          map((response) => ({
            request,
            companyEmails: response.companyEmailsStatus === 'resolved' ? response.companyEmails : [],
            primaryEmail: response.companyEmailsStatus === 'resolved' ? (response.primaryEmail ?? null) : null,
            companyEmailsStatus: response.companyEmailsStatus,
          })),
          // A failed optional address lookup never turns into a detail error.
          catchError((emailError: unknown) => {
            console.error('Failed to load company emails:', emailError);
            return of({ request, companyEmails: [], primaryEmail: null, companyEmailsStatus: 'failed' as const });
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
    return this._activeContext() && this.orgUid() && result?.request === this.detailRequest() ? result : null;
  });

  public readonly loading = computed(() => {
    const { orgUid, context } = this.detailRequest();
    return !!(orgUid && context && (context.personKey || context.username) && !this.currentDetail());
  });
  public readonly error = computed(() => this.currentDetail()?.error ?? false);
  public readonly detail = computed<OrgAllEmployeeDetail | null>(() => this.currentDetail()?.detail ?? null);

  public readonly emailsLoading = computed(() => {
    const { orgUid, context } = this.detailRequest();
    return !!(orgUid && context && (context.personKey || context.username) && !this.currentEmails());
  });
  public readonly emailError = computed(() => {
    const result = this.currentEmails();
    return !!result && result.companyEmailsStatus !== 'resolved' && result.companyEmailsStatus !== 'unavailable';
  });
  public readonly identityUnavailable = computed(() => this.currentEmails()?.companyEmailsStatus === 'unavailable');
  public readonly companyEmailsResolved = computed(() => this.currentEmails()?.companyEmailsStatus === 'resolved');
  public readonly companyEmails = computed<string[]>(() => this.currentEmails()?.companyEmails ?? NO_COMPANY_EMAILS.companyEmails);
  public readonly primaryCompanyEmail = computed<string | null>(() => this.currentEmails()?.primaryEmail ?? null);

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
