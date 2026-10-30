// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import type {
  OrgAllEmployeeDetail,
  OrgDrawerDetailResult,
  OrgDrawerKeyContactsResult,
  OrgKeyContactAssignment,
  OrgPersonCompanyEmailsResponse,
  OrgPersonKeyContactsResponse,
  PersonDrawerContext,
  PersonDrawerTab,
} from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { catchError, map, Observable, of, switchMap } from 'rxjs';

const NO_COMPANY_EMAILS: OrgPersonCompanyEmailsResponse = { companyEmails: [], primaryEmail: null, companyEmailsStatus: 'unavailable' };

/** No identity to look up, or the opener already supplied the roles: either way the request is not made. */
const NO_KEY_CONTACTS: OrgDrawerKeyContactsResult = { assignments: [], status: 'unidentified', error: false };

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

  // The roles read costs a company-address lookup, which is the slow Snowflake view the header's own read was
  // split out of. Most drawer opens never visit this tab, so it is fetched only once the tab is actually asked
  // for — and stays fetched for that person afterwards, so flipping back and forth does not refetch.
  private readonly _keyContactsRequested = signal(false);
  /** The organization the open context was supplied under; roles handed over by an opener belong to it alone. */
  private readonly _openedOrgUid = signal<string | null | undefined>(undefined);

  public readonly orgUid = computed(() => this.accountContext.selectedAccount().uid);
  // Activity, addresses and roles are separate requests off the same key, so none waits on another.
  private readonly detailRequest = computed(() => ({ orgUid: this.orgUid(), context: this._activeContext() }));
  /**
   * Opener-supplied roles, but only while the organization they were read under is still selected. The
   * drawer stays open across an account switch and every other read drops its stale answer at once; a
   * static array on the context would otherwise keep showing one organization's roles under another's
   * name, and suppress the fetch that would have corrected them.
   */
  private readonly suppliedKeyContacts = computed<OrgKeyContactAssignment[] | null>(() => {
    const supplied = this._activeContext()?.keyContactAssignments;
    return supplied && this._openedOrgUid() === this.orgUid() ? supplied : null;
  });
  /** The opener's Former tag, likewise only while its organization is still selected: employment status is per organization. */
  public readonly isFormer = computed(() => !!this._activeContext()?.isFormer && this._openedOrgUid() === this.orgUid());
  private readonly keyContactsRequest = computed(() => ({
    ...this.detailRequest(),
    keyContactsRequested: this._keyContactsRequested(),
    supplied: this.suppliedKeyContacts(),
  }));
  public readonly isOpen = computed(() => this._activeContext() !== null);

  private readonly detailResult = toSignal(
    toObservable(this.detailRequest).pipe(
      switchMap((request): Observable<OrgDrawerDetailResult & { request: typeof request }> => {
        const path = request.orgUid ? personPath(request.orgUid, request.context) : null;
        if (!path) {
          return of({ request, detail: null, error: false });
        }
        // The Maintainer pills follow the range the opener listed the person in; without one the BFF uses the Org Lens default range.
        // An opener with code filters gets its own row's Code counts in that range; without them, the trailing 12 months' commits.
        const range = request.context?.range;
        const codeFilters = request.context?.codeFilters;
        const teamMembers = request.context?.teamMembers;
        const orgScope = request.context?.orgScope;
        const params = {
          ...(range ? { range } : {}),
          ...(codeFilters ?? {}),
          ...(codeFilters && teamMembers ? { teamMembers } : {}),
          ...(codeFilters && orgScope ? { orgScope } : {}),
        };
        return this.http.get<OrgAllEmployeeDetail | null>(`${path}/detail`, { params }).pipe(
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
        // A live-only person resolves against the directory the opener showed, which the page has already warmed.
        const view = request.context?.directoryView;
        const params = view ? { range: view.range, projectScope: view.projectScope } : undefined;
        return this.http.get<OrgPersonCompanyEmailsResponse>(`${path}/company-emails`, { params }).pipe(
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

  private readonly keyContactsResult = toSignal(
    toObservable(this.keyContactsRequest).pipe(
      switchMap((request): Observable<OrgDrawerKeyContactsResult & { request: typeof request }> => {
        const path = request.orgUid ? personPath(request.orgUid, request.context) : null;
        // Tab never opened, nothing to look up, or the opener handed us the roles already — no request at all.
        if (!path || !request.keyContactsRequested || request.supplied) {
          return of({ request, ...NO_KEY_CONTACTS });
        }
        // The person-key route resolves the roster username itself; nothing identity-bearing goes in the URL.
        return this.http.get<OrgPersonKeyContactsResponse>(`${path}/key-contacts`).pipe(
          // A missing status is a failure, never a verified empty — same rule as the address read.
          map((response) => ({ request, ...response, status: response.status ?? 'failed', error: false })),
          // A failed roles read is its own state; it never turns into a detail error.
          catchError((keyContactsError: unknown) => {
            console.error('Failed to load key contact roles:', keyContactsError);
            return of({ request, assignments: [], status: 'failed' as const, error: true });
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

  private readonly currentKeyContacts = computed(() => {
    const result = this.keyContactsResult();
    return this._activeContext() && this.orgUid() && result?.request === this.keyContactsRequest() ? result : null;
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

  /** Supplied roles win over the fetch, the way `governanceSeats` does for Governance. */
  public readonly keyContacts = computed<OrgKeyContactAssignment[]>(() => this.suppliedKeyContacts() ?? this.currentKeyContacts()?.assignments ?? []);
  public readonly keyContactsLoading = computed(() => {
    const { orgUid, context, keyContactsRequested } = this.keyContactsRequest();
    return !!(
      keyContactsRequested &&
      orgUid &&
      context &&
      !this.suppliedKeyContacts() &&
      (context.personKey || context.username) &&
      !this.currentKeyContacts()
    );
  });
  /** A read that errored or answered `failed` — retryable, unlike the two states below. */
  public readonly keyContactsError = computed(() => {
    const result = this.currentKeyContacts();
    return !!result && (result.error || result.status === 'failed');
  });
  /** False when the lookup never worked out who this is — distinct from a verified empty list. */
  public readonly keyContactsIdentified = computed(() => !!this.suppliedKeyContacts() || this.currentKeyContacts()?.status === 'resolved');

  public open(context: PersonDrawerContext): void {
    const tab = context.defaultTab ?? 'events';
    this._keyContactsRequested.set(tab === 'key-contacts');
    this._openedOrgUid.set(this.orgUid());
    this._activeTab.set(tab);
    this._activeContext.set(context);
  }

  public close(): void {
    this._activeContext.set(null);
  }

  public setTab(tab: PersonDrawerTab): void {
    if (tab === 'key-contacts') {
      this._keyContactsRequested.set(true);
    }
    this._activeTab.set(tab);
  }
}
