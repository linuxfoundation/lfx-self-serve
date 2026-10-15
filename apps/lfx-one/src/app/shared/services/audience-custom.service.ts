// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { AUDIENCE_CUSTOM_CREATE_DEFINITE_FAILURES } from '@lfx-one/shared/constants';
import { defer, finalize, Observable, tap } from 'rxjs';

import type {
  AudienceComposedList,
  AudienceCustomCreateOutcome,
  AudienceCustomInterpretRequest,
  AudienceCustomInterpretResult,
  AudienceCustomPreview,
  AudienceCustomRequest,
} from '@lfx-one/shared/interfaces';

/**
 * Custom-audience calls for the Audience tab's "Build a custom audience" step.
 *
 * Separate from `CampaignService` so the custom builder owns its own requests: the flow
 * (describe → answer → edit → preview → create) is self-contained and never feeds the tab's
 * discovery state, only the one list it finally creates.
 */
@Injectable({ providedIn: 'root' })
export class AudienceCustomService {
  private readonly http = inject(HttpClient);

  /**
   * Creates still on the wire, by project → the name they were sent with. Kept here, not in the
   * builder, because a create outlives the builder that started it: navigating away must not let a
   * remounted builder offer a second create while the first may still be landing in HubSpot.
   */
  private readonly inFlight = signal<ReadonlyMap<string, string>>(new Map());

  /**
   * How the last create for each project settled, until a builder takes it. A builder that saw the
   * reply itself takes it at once; one that was destroyed first never does, so a remounted builder
   * finds it here instead of offering a second create.
   */
  private readonly outcomes = signal<ReadonlyMap<string, AudienceCustomCreateOutcome>>(new Map());

  /** The unclaimed outcome of this project's last create, if any. A signal, so a builder mounted while it was still in flight sees it land. */
  public createOutcome(projectSlug: string): AudienceCustomCreateOutcome | null {
    return this.outcomes().get(projectSlug) ?? null;
  }

  /** Takes (and forgets) the unclaimed outcome of this project's last create, if any. */
  public takeCreateOutcome(projectSlug: string): AudienceCustomCreateOutcome | null {
    const outcome = this.createOutcome(projectSlug);
    if (outcome) {
      this.outcomes.update((all) => {
        const next = new Map(all);
        next.delete(projectSlug);
        return next;
      });
    }
    return outcome;
  }

  /** The name of a create still in flight for this project, or null. */
  public inFlightCreate(projectSlug: string): string | null {
    return this.inFlight().get(projectSlug) ?? null;
  }

  /** Free text → draft criteria and blocking questions. Uses a model; creates nothing. */
  public interpret(projectSlug: string, request: AudienceCustomInterpretRequest): Observable<AudienceCustomInterpretResult> {
    return this.http.post<AudienceCustomInterpretResult>('/api/campaigns/audience-builder/custom/interpret', request, { params: { project: projectSlug } });
  }

  /** Validates criteria against the portal and returns what create would build. Creates nothing. */
  public preview(projectSlug: string, request: AudienceCustomRequest): Observable<AudienceCustomPreview> {
    return this.http.post<AudienceCustomPreview>('/api/campaigns/audience-builder/custom/preview', request, { params: { project: projectSlug } });
  }

  /** Creates ONE contact list in HubSpot. Not idempotent: only a refused request (4xx) is safe to retry. */
  public create(projectSlug: string, request: AudienceCustomRequest): Observable<AudienceComposedList> {
    return defer(() => {
      this.inFlight.update((all) => new Map(all).set(projectSlug, request.name ?? ''));
      return this.http.post<AudienceComposedList>('/api/campaigns/audience-builder/custom/create', request, { params: { project: projectSlug } });
    }).pipe(
      tap({
        next: (list) => this.outcomes.update((all) => new Map(all).set(projectSlug, { kind: 'created', list })),
        error: (err: unknown) => {
          const status = err instanceof HttpErrorResponse ? err.status : 0;
          if (!AUDIENCE_CUSTOM_CREATE_DEFINITE_FAILURES.includes(status)) {
            const body = status === 502 && err instanceof HttpErrorResponse ? (err.error as { masterName?: string } | null) : null;
            const outcome: AudienceCustomCreateOutcome = { kind: 'unconfirmed', name: body?.masterName || request.name || 'the custom list' };
            this.outcomes.update((all) => new Map(all).set(projectSlug, outcome));
          }
        },
      }),
      finalize(() =>
        this.inFlight.update((all) => {
          const next = new Map(all);
          next.delete(projectSlug);
          return next;
        })
      )
    );
  }
}
