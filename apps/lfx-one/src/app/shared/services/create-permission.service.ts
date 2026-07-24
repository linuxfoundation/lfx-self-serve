// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterNextRender, computed, DestroyRef, inject, Injectable, Signal, signal, WritableSignal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CREATABLE_ARTIFACTS } from '@lfx-one/shared/constants';
import { CreatableArtifactType, CreatePickerResultSet } from '@lfx-one/shared/interfaces';
import { CreateTargetPickerService } from '@services/create-target-picker.service';

const EMPTY_RESULT: CreatePickerResultSet = { projects: [], committees: [] };

/**
 * Decides whether the rail "Create" quick-link (and which artifact types) is offered to the
 * current user — LFXV2-2838.
 *
 * Sourced from the create picker's own `GET /api/create-picker/tree` (probed with
 * `artifactType: 'meeting'`, the broadest relation set — project writer, project
 * `meeting_coordinator`, and committee writer all included) rather than `GET /api/projects`
 * (unpaginated, batch access-checks every visible project). This used to go through
 * `WriterGrantsService.writerProjects`, which is exactly that full pull; `LensService` still
 * uses `WriterGrantsService` for its own (unrelated, general-navigation) lens-widening, but the
 * create path no longer touches it.
 *
 * All-or-nothing by design: a `writer`/`meeting_coordinator`/committee-writer grant is not
 * per-type, so every type is offered together once any direct-grant target exists. This probes
 * direct grants only (search isn't run here — that would mean enumerating), so it's intentionally
 * an *undershow*: a user reachable only through the picker's search (inherited writer, no direct
 * grants) won't light up this button. The create routes' `writerGuard` remains the actual
 * authority regardless of what this button advertises — it only ever narrows the affordance, it
 * never grants access.
 *
 * Everything resolves to `[]` while loading and on error (the underlying service fails closed),
 * keeping the rail button hidden until eligibility is proven.
 *
 * Persona note (ED): still no ED fast-path here, unlike `writerGuard` — unchanged trade-off from
 * before this rebuild (LFXV2-2721).
 */
@Injectable({
  providedIn: 'root',
})
export class CreatePermissionService {
  private readonly pickerService = inject(CreateTargetPickerService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly eligibility: WritableSignal<CreatePickerResultSet> = signal(EMPTY_RESULT);

  /** True when the user has at least one direct-grant project or committee to create against. */
  private readonly hasEligibleTarget: Signal<boolean> = computed(() => {
    const result = this.eligibility();
    return result.projects.length > 0 || result.committees.length > 0;
  });

  /** Artifact types offered to the user — all types when eligible, else none (see class doc). */
  public readonly creatableTypes: Signal<CreatableArtifactType[]> = computed(() =>
    this.hasEligibleTarget() ? CREATABLE_ARTIFACTS.map((artifact) => artifact.type) : []
  );

  /** True when the user can create on at least one project or committee. */
  public readonly canShowCreateButton: Signal<boolean> = this.hasEligibleTarget;

  public constructor() {
    // Deferred to after the first render, mirroring the previous full-pull's SSR-safety
    // rationale even though this probe is now cheap (direct-grant only) — any avoidable HTTP
    // round trip during SSR still risks TTFB, so it stays off the critical render path.
    afterNextRender(() => {
      this.pickerService
        .getTree('meeting')
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe((result) => this.eligibility.set(result));
    });
  }
}
