// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { EMPTY_ORG_ALL_EMPLOYEE_DETAIL } from '@lfx-one/shared/constants';
import type { OrgAllEmployeeDetail, OrgLensCompanyEmailsResponse, PersonDrawerContext, PersonDrawerTab } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { catchError, combineLatest, distinctUntilChanged, map, of, switchMap, tap } from 'rxjs';

/** Cross-page open state + detail fetch for the shared person-detail drawer (LFXV2-2195). */
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

  private readonly _loading = signal<boolean>(false);
  public readonly loading = this._loading.asReadonly();

  private readonly _error = signal<boolean>(false);
  public readonly error = this._error.asReadonly();

  public readonly isOpen = computed(() => this._activeContext() !== null);

  public readonly detail = toSignal<OrgAllEmployeeDetail | null>(
    combineLatest([
      toObservable(this.accountContext.selectedAccount).pipe(
        map((account) => account.uid),
        distinctUntilChanged()
      ),
      toObservable(this._activeContext),
    ]).pipe(
      switchMap(([orgUid, context]) => {
        if (!context || !orgUid) {
          this._loading.set(false);
          this._error.set(false);
          return of(null);
        }
        if (context.personKey) {
          this._loading.set(true);
          this._error.set(false);
          const url = `/api/orgs/${encodeURIComponent(orgUid)}/lens/people/${encodeURIComponent(context.personKey)}/detail`;
          return this.http.get<OrgAllEmployeeDetail>(url).pipe(
            tap(() => this._loading.set(false)),
            catchError(() => {
              this._error.set(true);
              this._loading.set(false);
              return of(null);
            })
          );
        }
        // No personKey (Board/Committee openers) — governanceSeats are pre-supplied via context, but
        // companyEmails still need a server-side lookup by the raw email so both tabs share the same
        // deriveDemoCompanyEmails logic as the personKey-based path. POST (not GET) so the email
        // travels in the body, not the query string, keeping it out of request-log URLs.
        if (context.email) {
          this._loading.set(true);
          this._error.set(false);
          const url = `/api/orgs/${encodeURIComponent(orgUid)}/lens/people/company-emails`;
          return this.http.post<OrgLensCompanyEmailsResponse>(url, { email: context.email }).pipe(
            map((response) => ({ ...EMPTY_ORG_ALL_EMPLOYEE_DETAIL, companyEmails: response.companyEmails })),
            tap(() => this._loading.set(false)),
            catchError(() => {
              this._error.set(true);
              this._loading.set(false);
              return of(null);
            })
          );
        }
        this._loading.set(false);
        this._error.set(false);
        return of(null);
      })
    ),
    { initialValue: null }
  );

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
