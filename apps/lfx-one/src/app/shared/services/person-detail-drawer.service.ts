// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import type { OrgAllEmployeeDetail, PersonDrawerContext, PersonDrawerTab } from '@lfx-one/shared/interfaces';
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
        // No personKey → skip fetch; Board/Committee openers supply governanceSeats instead.
        if (!context || !orgUid || !context.personKey) {
          this._loading.set(false);
          this._error.set(false);
          return of(null);
        }
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
