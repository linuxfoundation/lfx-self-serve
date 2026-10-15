// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { defer, finalize, Observable } from 'rxjs';

import type {
  AudienceComposedList,
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
