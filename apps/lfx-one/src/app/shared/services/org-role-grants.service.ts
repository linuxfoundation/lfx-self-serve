// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { afterNextRender, computed, inject, Injectable, Signal, signal, WritableSignal } from '@angular/core';
import { ORG_ROLE_GRANTS_REFRESH_PARAM } from '@lfx-one/shared/constants';
import { CascadingRoleGrant, OrgLensLookupOutcome, OrgLensStaffCheck, RoleGrantsResponse } from '@lfx-one/shared/interfaces';
import { catchError, map, Observable, of, tap } from 'rxjs';

import { classifySectionError } from '../utils/org-lens-empty-state.utils';

// Re-export the shared persona type so existing consumers can keep importing from this service module.
export type { OrgRolePersona } from '@lfx-one/shared/interfaces';

/** Session-scoped role-grants dictionary; eager-loaded on browser hydration. No mid-session invalidation per FR-018a (token refresh happens server-side). */
@Injectable({
  providedIn: 'root',
})
export class OrgRoleGrantsService {
  private readonly http = inject(HttpClient);

  // `writerSet` / `auditorSet` stay DIRECT-ONLY by design: they answer "is this grant the caller's
  // own?", which is what the selector's persona badge and its "(Original)"/"(Inherited)" copy need.
  // Since LFXV2-3029 they are NOT the edit gate — `editorSet` below is. Widening these would erase
  // the direct-vs-inherited distinction the badge depends on.
  private readonly writerSetInternal: WritableSignal<Set<string>> = signal<Set<string>>(new Set());
  private readonly auditorSetInternal: WritableSignal<Set<string>> = signal<Set<string>>(new Set());
  // Spec 022 — additive, dropdown-only surface for the inherited badge + tooltip. Disjoint from writerSet / auditorSet.
  private readonly inheritedWriterSetInternal: WritableSignal<Set<string>> = signal<Set<string>>(new Set());
  private readonly inheritedAuditorSetInternal: WritableSignal<Set<string>> = signal<Set<string>>(new Set());
  private readonly parentNameByUidInternal: WritableSignal<Map<string, string>> = signal<Map<string, string>>(new Map());
  private readonly loadedInternal: WritableSignal<boolean> = signal<boolean>(false);
  private readonly loadingInternal: WritableSignal<boolean> = signal<boolean>(false);
  private readonly errorInternal: WritableSignal<string | null> = signal<string | null>(null);
  private readonly loadedAtMsInternal: WritableSignal<number | null> = signal<number | null>(null);
  // Caller-level, not per-org: LF-team membership (global auditor population) carries read access to every org, so it is
  // deliberately not folded into the sets above. Defaults false and resets to false on error.
  private readonly isStaffInternal: WritableSignal<boolean> = signal<boolean>(false);
  // #2961 — an LF contractor (not LF team). Explains an empty Org Lens only; it grants nothing and never widens the switcher.
  private readonly isContractorInternal: WritableSignal<boolean> = signal<boolean>(false);
  // LFXV2-3029 — the server resolved fewer orgs than the caller may actually hold (roll-up
  // expansion or authoritative classification was incomplete). Without it an empty/short list is
  // indistinguishable from "you have no organizations", so an outage reads as a revocation.
  private readonly degradedInternal: WritableSignal<boolean> = signal<boolean>(false);
  // Spec 053 (FR-020) — why the sets are a lower bound: `failed` (roster never loaded — the answer is
  // unknown) vs `partial` (direct grants loaded, roll-up incomplete — every listed uid is authoritative).
  private readonly lookupOutcomeInternal: WritableSignal<OrgLensLookupOutcome> = signal<OrgLensLookupOutcome>('ok');
  // Spec 053 (FR-011) — the LF-team check threw; `isStaff` is a fail-closed false, not a verdict.
  private readonly staffCheckInternal: WritableSignal<OrgLensStaffCheck> = signal<OrgLensStaffCheck>('ok');
  private readonly correlationIdInternal: WritableSignal<string | null> = signal<string | null>(null);

  public readonly writerSet: Signal<Set<string>> = this.writerSetInternal.asReadonly();
  public readonly auditorSet: Signal<Set<string>> = this.auditorSetInternal.asReadonly();
  public readonly inheritedWriterSet: Signal<Set<string>> = this.inheritedWriterSetInternal.asReadonly();
  public readonly inheritedAuditorSet: Signal<Set<string>> = this.inheritedAuditorSetInternal.asReadonly();
  /**
   * LFXV2-3029 — "editor from any source": `writerSet` (direct) union `inheritedWriterSet`
   * (roll-up-derived). Every organization-edit capability gate should read this, not the
   * direct-only `writerSet` — every edit surface a direct editor can reach is meant to also open
   * for a roll-up editor. `writerSet` itself is kept direct-only for callers that still need that
   * narrower, direct-only answer specifically.
   */
  public readonly editorSet: Signal<Set<string>> = computed(() => new Set([...this.writerSetInternal(), ...this.inheritedWriterSetInternal()]));
  /** Child uid → parent display name; used to render the dropdown tooltip without a second lookup. */
  public readonly parentNameByUid: Signal<Map<string, string>> = this.parentNameByUidInternal.asReadonly();
  public readonly loaded: Signal<boolean> = this.loadedInternal.asReadonly();
  public readonly loading: Signal<boolean> = this.loadingInternal.asReadonly();
  public readonly error: Signal<string | null> = this.errorInternal.asReadonly();
  public readonly loadedAtMs: Signal<number | null> = this.loadedAtMsInternal.asReadonly();
  /** Caller is a member of an LF team (`lf-staff`; `auditor` on every org). Drives switcher visibility and the catalogue-search affordance. */
  public readonly isStaff: Signal<boolean> = this.isStaffInternal.asReadonly();
  public readonly isContractor: Signal<boolean> = this.isContractorInternal.asReadonly();
  /** The resolved grant sets are a lower bound, not the caller's full set. True on a degraded server lookup and on a transport failure, so an empty-state caller can say the lookup broke instead of asserting the caller has no organizations. */
  public readonly degraded: Signal<boolean> = this.degradedInternal.asReadonly();
  /** Spec 053 — `failed`: nothing in the sets is trustworthy; `partial`: the sets are a lower bound; `ok`: complete. Derived from `degraded` when the server predates the field. */
  public readonly lookupOutcome: Signal<OrgLensLookupOutcome> = this.lookupOutcomeInternal.asReadonly();
  /** Spec 053 — `failed` means the caller's staff status could not be determined; the page must never render the employee no-access copy on it. */
  public readonly staffCheck: Signal<OrgLensStaffCheck> = this.staffCheckInternal.asReadonly();
  /** Spec 053 — support reference for the staff-check-failed state; null otherwise. */
  public readonly correlationId: Signal<string | null> = this.correlationIdInternal.asReadonly();

  public constructor() {
    afterNextRender(() => {
      this.refresh().subscribe();
    });
  }

  /**
   * Re-fetch role grants; idempotent. Returns Observable<void> so callers can compose (e.g. forkJoin
   * with persona refresh). `bypassCache` (the viewer's explicit Retry, spec 053) asks the BFF to skip
   * its cache read and recompute — still coalesced and written server-side.
   */
  public refresh(bypassCache = false): Observable<void> {
    this.loadingInternal.set(true);
    this.errorInternal.set(null);
    const params = bypassCache ? { [ORG_ROLE_GRANTS_REFRESH_PARAM]: '1' } : undefined;
    return this.http.get<RoleGrantsResponse>('/api/orgs/me/role-grants', { params }).pipe(
      tap((response) => {
        this.writerSetInternal.set(new Set(response.writers));
        this.auditorSetInternal.set(new Set(response.auditors));
        this.inheritedWriterSetInternal.set(new Set((response.cascadingWriters ?? []).map((entry: CascadingRoleGrant) => entry.uid)));
        this.inheritedAuditorSetInternal.set(new Set((response.cascadingAuditors ?? []).map((entry: CascadingRoleGrant) => entry.uid)));
        this.parentNameByUidInternal.set(this.buildParentNameMap(response));
        this.isStaffInternal.set(response.isStaff === true);
        // Absent on an older server ⇒ false, so a rolling deploy never shows the contractor state by mistake.
        this.isContractorInternal.set(response.isContractor === true);
        this.degradedInternal.set(response.degraded === true);
        // Absent on a pre-053 server: derive from the coarse flag so old+new deploy mixes stay safe.
        this.lookupOutcomeInternal.set(response.lookupOutcome ?? (response.degraded === true ? 'partial' : 'ok'));
        this.staffCheckInternal.set(response.staffCheck ?? 'ok');
        this.correlationIdInternal.set(response.staffCheck === 'failed' && response.correlationId ? response.correlationId : null);
        this.loadedInternal.set(true);
        this.loadingInternal.set(false);
        this.loadedAtMsInternal.set(Date.now());
      }),
      catchError((error: unknown) => {
        const message = error instanceof Error ? error.message : 'Unknown error';
        this.errorInternal.set(message);
        // BFF downgrades upstream failures to empty 200 per contract, so reaching this branch typically means a transport-level failure.
        // Treat as empty grants → sidebar visibility gate falls back to persona seeds.
        this.writerSetInternal.set(new Set());
        this.auditorSetInternal.set(new Set());
        this.inheritedWriterSetInternal.set(new Set());
        this.inheritedAuditorSetInternal.set(new Set());
        this.parentNameByUidInternal.set(new Map());
        this.isStaffInternal.set(false);
        this.isContractorInternal.set(false);
        // The grants are unknown, not empty — same distinction the server's `degraded` draws.
        this.degradedInternal.set(true);
        this.lookupOutcomeInternal.set('failed');
        this.staffCheckInternal.set('ok');
        this.correlationIdInternal.set(null);
        this.loadedInternal.set(true);
        this.loadingInternal.set(false);
        return of(undefined);
      }),
      map(() => undefined)
    );
  }

  /**
   * #2961 — asks the server's Org Lens read gate whether the caller may read `orgUid`: `true` when admitted
   * (204), `false` only for the gate's refusal (403 `FORBIDDEN`). Any other failure — the gate could not
   * verify (503), a network error — answers `true`: an outage is not a refusal, so it must not render
   * `contractor-no-grant`; the page's own sections report it.
   */
  public readCheck(orgUid: string): Observable<boolean> {
    return this.http.get(`/api/orgs/${encodeURIComponent(orgUid)}/lens/read-check`, { observe: 'response' }).pipe(
      map(() => true),
      catchError((error: unknown) => {
        if (classifySectionError(error) === 'denied') {
          return of(false);
        }
        // Not a refusal: keep the page (its sections report the outage), but leave a trace.
        console.warn('[org-lens] read-check did not answer; treating the organization as readable', error);
        return of(true);
      })
    );
  }

  private buildParentNameMap(response: RoleGrantsResponse): Map<string, string> {
    const map = new Map<string, string>();
    for (const entry of response.cascadingWriters ?? []) {
      if (entry.uid && entry.parentName) map.set(entry.uid, entry.parentName);
    }
    for (const entry of response.cascadingAuditors ?? []) {
      if (entry.uid && entry.parentName && !map.has(entry.uid)) map.set(entry.uid, entry.parentName);
    }
    return map;
  }
}
