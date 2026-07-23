// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterNextRender, DestroyRef, inject, Injectable, Signal, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpParams } from '@angular/common/http';
import { Committee, CreatableCommittee } from '@lfx-one/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import { map } from 'rxjs';

/**
 * The user's per-committee `writer` grants — the committee-side sibling of
 * {@link WriterGrantsService}. Kept as a separate service (rather than folded into
 * `WriterGrantsService`) so the committee-target grants list isn't entangled with
 * {@link LensService}'s persona-only lens derivation — committees never affect which
 * lens is available, only which create targets are offered.
 *
 * `GET /api/committees?include_project_metadata=true` batch access-checks every visible
 * committee (returning `writer` per committee) and additionally enriches each with the
 * owning project's `project_slug` / `is_foundation`, which the plain list call does not
 * populate. The enrichment is required here: navigation seeds the create-flow's
 * project/foundation slot from `?project=<slug>`, so a committee-only writer's target must
 * carry a resolved slug rather than just the raw `project_uid`.
 *
 * Only {@link CreatePermissionService} consumes this — committee grants never widen the
 * lens set (see LFXV2-2755, which also reverts the lens layer back to persona-only).
 *
 * Resolves to `[]` while loading and on error — callers fail closed, matching
 * `CommitteeService.getCommittees()`'s internal `catchError(() => of([]))`.
 */
@Injectable({
  providedIn: 'root',
})
export class CommitteeWriterGrantsService {
  private readonly committeeService = inject(CommitteeService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly grants = signal<CreatableCommittee[]>([]);

  /** Committees the user holds `writer` on. Empty until the post-hydration fetch resolves. */
  public readonly writerCommittees: Signal<CreatableCommittee[]> = this.grants.asReadonly();

  public constructor() {
    // Fetch after hydration, mirroring WriterGrantsService — the enrichment costs an extra
    // upstream project fetch per distinct project_uid, so it must not block SSR's TTFB.
    afterNextRender(() => {
      const params = new HttpParams().set('include_project_metadata', 'true');

      this.committeeService
        .getCommittees(params)
        .pipe(
          map((committees) =>
            committees
              .filter((committee) => committee.writer === true)
              .map(toCreatableCommittee)
              .filter(isResolvedCommittee)
          ),
          takeUntilDestroyed(this.destroyRef)
        )
        .subscribe((committees) => this.grants.set(committees));
    });
  }
}

/**
 * Project a raw enriched `Committee` down to the fields the create picker needs.
 * Returns `null` when `project_slug` didn't resolve (e.g. the owning project fetch failed
 * during enrichment) — a committee target without a navigable project slug can't seed the
 * create-flow's project slot, so it's dropped rather than offered as a broken option.
 */
function toCreatableCommittee(committee: Committee): CreatableCommittee | null {
  if (!committee.project_slug) {
    return null;
  }

  return {
    uid: committee.uid,
    name: committee.name,
    logoUrl: undefined,
    projectUid: committee.project_uid,
    projectSlug: committee.project_slug,
    projectName: committee.project_name ?? '',
    isFoundation: committee.is_foundation ?? false,
  };
}

function isResolvedCommittee(committee: CreatableCommittee | null): committee is CreatableCommittee {
  return committee !== null;
}
