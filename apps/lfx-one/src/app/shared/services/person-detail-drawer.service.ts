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
import { catchError, combineLatest, distinctUntilChanged, map, of, switchMap, tap } from 'rxjs';

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

  private readonly _loading = signal<boolean>(false);
  public readonly loading = this._loading.asReadonly();

  private readonly _error = signal<boolean>(false);
  public readonly error = this._error.asReadonly();

  // Separate from _error: a failed company-emails lookup must not flip the activity tabs to
  // "Couldn't load this person's details" (see the personKey/username branches below), but the
  // header still needs to distinguish "lookup failed" from a genuine "no company email" result.
  private readonly _emailError = signal<boolean>(false);
  public readonly emailError = this._emailError.asReadonly();

  // True when the opener carried no identity at all, so no lookup was even attempted. Distinct from
  // an empty result: "we cannot look this up from here" must not render as "this person has no
  // company address", which would assert something untrue about a named individual.
  private readonly _identityUnavailable = signal<boolean>(false);
  public readonly identityUnavailable = this._identityUnavailable.asReadonly();

  public readonly isOpen = computed(() => this._activeContext() !== null);

  private readonly fetchResult = toSignal(
    combineLatest([
      toObservable(this.accountContext.selectedAccount).pipe(
        map((account) => account.uid),
        distinctUntilChanged()
      ),
      toObservable(this._activeContext),
      toObservable(this.companyEmailFeatureEnabled),
    ]).pipe(
      switchMap(([orgUid, context, companyEmailFeatureEnabled]) => {
        if (!context || !orgUid) {
          this._loading.set(false);
          this._error.set(false);
          this._emailError.set(false);
          this._identityUnavailable.set(false);
          return of(EMPTY_FETCH_RESULT);
        }
        if (context.personKey) {
          this._loading.set(true);
          this._error.set(false);
          this._emailError.set(false);
          this._identityUnavailable.set(false);
          const url = `/api/orgs/${encodeURIComponent(orgUid)}/lens/people/${encodeURIComponent(context.personKey)}/detail`;
          return this.http.get<OrgAllEmployeeDetail>(url).pipe(
            // Fail closed on the status. `resolved` is the ONLY value that exposes addresses; anything
            // else — `failed`, `unavailable`, or a missing status — is rendered as "couldn't be loaded"
            // or "not available", never as "none on record". A missing status is the pre-change detail
            // shape from an older replica during a rolling deployment, whose `companyEmails` held the
            // demo-derived addresses this feature deletes; those must not reach the panel.
            map((detail) => ({
              detail,
              companyEmails: detail.companyEmailsStatus === 'resolved' ? detail.companyEmails : [],
            })),
            tap((result) => {
              const status = result.detail?.companyEmailsStatus;
              this._identityUnavailable.set(status === 'unavailable');
              this._emailError.set(status !== 'resolved' && status !== 'unavailable');
              this._loading.set(false);
            }),
            catchError(() => {
              this._error.set(true);
              this._loading.set(false);
              return of(EMPTY_FETCH_RESULT);
            })
          );
        }
        // No personKey (governance openers) — governanceSeats are pre-supplied via context, and the
        // addresses are looked up by the LF username the row already carries. Never by
        // `context.email`: that field is display-only, and resolving a person from an address is
        // prohibited. `detail` stays null here — there's no personKey to fetch real activity for, so
        // the drawer's "Detailed activity isn't available" state must stay truthful rather than
        // showing verified-empty tabs.
        if (context.username && companyEmailFeatureEnabled) {
          this._loading.set(true);
          this._error.set(false);
          this._emailError.set(false);
          this._identityUnavailable.set(false);
          const url = `/api/orgs/${encodeURIComponent(orgUid)}/lens/people/by-username/${encodeURIComponent(context.username)}/company-emails`;
          return this.http.get<OrgPersonCompanyEmailsResponse>(url).pipe(
            // Same fail-closed contract as the detail branch: `unavailable` is a real answer here (the
            // username is not on the address model's spine — an Access principal with no warehouse
            // presence — or the server flag is off) and must render as "not available", not "none on
            // record". A missing status is an older replica and is treated as failed. The signals are
            // set before `map` drops the status from the result.
            tap((response) => {
              const status = response.companyEmailsStatus;
              this._identityUnavailable.set(status === 'unavailable');
              this._emailError.set(status !== 'resolved' && status !== 'unavailable');
              this._loading.set(false);
            }),
            map((response) => ({
              detail: null,
              companyEmails: response.companyEmailsStatus === 'resolved' ? response.companyEmails : [],
            })),
            // Keep failures local to this optional lookup — no personKey means no activity was ever
            // fetched, so setting the shared _error signal here would wrongly flip the activity tabs
            // to "Couldn't load this person's details" instead of the truthful "not available" state.
            // _emailError instead lets the header distinguish "lookup failed" from "no company email".
            catchError((err) => {
              console.error('Failed to load company emails:', err);
              this._emailError.set(true);
              this._loading.set(false);
              return of(EMPTY_FETCH_RESULT);
            })
          );
        }
        // The opener carried neither a personKey nor a username — Project Detail card rosters supply
        // only a display name. No lookup is possible, so flag it rather than fall through to an empty
        // result that the header would render as "no company address on record".
        this._loading.set(false);
        this._error.set(false);
        this._emailError.set(false);
        this._identityUnavailable.set(true);
        return of(EMPTY_FETCH_RESULT);
      })
    ),
    { initialValue: EMPTY_FETCH_RESULT }
  );

  public readonly detail = computed<OrgAllEmployeeDetail | null>(() => this.fetchResult().detail);
  public readonly companyEmails = computed<string[]>(() => this.fetchResult().companyEmails);

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
