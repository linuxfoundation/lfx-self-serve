// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ORG_LENS_PRIVATE_RELEASE_FLAG } from '@lfx-one/shared/constants';
import type {
  OrgAllEmployeeDetail,
  OrgDrawerFetchResult,
  OrgPersonCompanyEmailsResponse,
  PersonDrawerContext,
  PersonDrawerTab,
} from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { FeatureFlagService } from '@services/feature-flag.service';
import { catchError, map, of, switchMap } from 'rxjs';

const EMPTY_FETCH_RESULT: OrgDrawerFetchResult = { detail: null, companyEmails: [] };

/** Cross-page open state + detail fetch for the shared person-detail drawer (LFXV2-2195). */
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
  private readonly request = computed(() => ({
    orgUid: this.orgUid(),
    context: this._activeContext(),
    companyEmailFeatureEnabled: this.companyEmailFeatureEnabled(),
  }));
  public readonly isOpen = computed(() => this._activeContext() !== null);

  private readonly fetchResult = toSignal(
    toObservable(this.request).pipe(
      switchMap((request) => {
        const { orgUid, context, companyEmailFeatureEnabled } = request;
        if (!context || !orgUid) {
          return of({ ...EMPTY_FETCH_RESULT, request, companyEmailsStatus: 'unavailable', error: false });
        }
        if (context.personKey) {
          const url = `/api/orgs/${encodeURIComponent(orgUid)}/lens/people/${encodeURIComponent(context.personKey)}/detail`;
          return this.http.get<OrgAllEmployeeDetail>(url).pipe(
            // Only a resolved lookup may expose addresses; an older replica may return addresses without a status.
            map((detail) => ({
              request,
              detail,
              companyEmails: detail.companyEmailsStatus === 'resolved' ? detail.companyEmails : [],
              companyEmailsStatus: detail.companyEmailsStatus,
              error: false,
            })),
            catchError(() => of({ ...EMPTY_FETCH_RESULT, request, companyEmailsStatus: 'failed', error: true }))
          );
        }
        // Governance openers have no activity key: addresses resolve by LF username only, never by an email address.
        if (context.username && companyEmailFeatureEnabled) {
          const url = `/api/orgs/${encodeURIComponent(orgUid)}/lens/people/by-username/${encodeURIComponent(context.username)}/company-emails`;
          return this.http.get<OrgPersonCompanyEmailsResponse>(url).pipe(
            map((response) => ({
              request,
              detail: null,
              companyEmails: response.companyEmailsStatus === 'resolved' ? response.companyEmails : [],
              companyEmailsStatus: response.companyEmailsStatus,
              error: false,
            })),
            // A failed optional email lookup must not turn unavailable activity into a fetch error.
            catchError((err) => {
              console.error('Failed to load company emails:', err);
              return of({ ...EMPTY_FETCH_RESULT, request, companyEmailsStatus: 'failed', error: false });
            })
          );
        }
        return of({ ...EMPTY_FETCH_RESULT, request, companyEmailsStatus: 'unavailable', error: false });
      })
    ),
    { initialValue: null }
  );

  // toObservable starts on the next effect flush and toSignal retains the last response until then;
  // match the whole request synchronously so nothing leaks to a newly opened person.
  private readonly currentResult = computed(() => {
    const result = this.fetchResult();
    return this._activeContext() && this.orgUid() && result?.request === this.request() ? result : null;
  });

  public readonly loading = computed(() => {
    const { orgUid, context, companyEmailFeatureEnabled } = this.request();
    return !!(orgUid && context && (context.personKey || (context.username && companyEmailFeatureEnabled)) && !this.currentResult());
  });
  public readonly error = computed(() => this.currentResult()?.error ?? false);
  public readonly emailError = computed(() => {
    const result = this.currentResult();
    return !!result && result.companyEmailsStatus !== 'resolved' && result.companyEmailsStatus !== 'unavailable';
  });
  public readonly identityUnavailable = computed(() => this.currentResult()?.companyEmailsStatus === 'unavailable');
  public readonly companyEmailsResolved = computed(() => this.currentResult()?.companyEmailsStatus === 'resolved');
  public readonly detail = computed<OrgAllEmployeeDetail | null>(() => this.currentResult()?.detail ?? null);
  public readonly companyEmails = computed<string[]>(() => this.currentResult()?.companyEmails ?? EMPTY_FETCH_RESULT.companyEmails);

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
