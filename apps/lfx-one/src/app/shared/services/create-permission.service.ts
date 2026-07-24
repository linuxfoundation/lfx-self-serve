// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterNextRender, computed, DestroyRef, inject, Injectable, Signal, signal, WritableSignal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CREATABLE_ARTIFACTS, EMPTY_CREATE_PICKER_RESULT } from '@lfx-one/shared/constants';
import { CreatableArtifactType, CreatePickerResultSet } from '@lfx-one/shared/interfaces';
import { CreateTargetPickerService } from '@services/create-target-picker.service';

/**
 * Decides which artifact types the rail "Create" quick-link offers — LFXV2-2838.
 *
 * The rail button itself is always shown (see `canShowCreateButton` below) — it does not gate on
 * any eligibility probe. An earlier version sourced visibility from the create picker's
 * direct-grant-only `GET /api/create-picker/tree`, but that hides the button entirely for a pure
 * inherited-writer (a user with real, evaluated access via inheritance but zero direct FGA
 * tuples) — exactly the class of user this ticket's picker rebuild exists to serve, since their
 * only path to a target is the picker's search, which they could never reach if the button that
 * opens the picker stayed hidden. The picker's own fail-closed empty state (tree and search both
 * empty) is what communicates zero access now, same as it already does inside the dialog.
 *
 * `creatableTypes` still probes `GET /api/create-picker/tree` — with `artifactType: 'newsletter'`
 * specifically, a writer-only type (no `meeting_coordinator` or committee-writer relation
 * included, see `COMMITTEE_WRITE_ARTIFACT_TYPES`). A `newsletter`-eligible target implies genuine
 * project `writer`, which is valid for every one of the six creatable types — probing with
 * `'meeting'` instead (as this service originally did) would let a `meeting_coordinator`-only or
 * committee-writer-only user's probe succeed too, over-showing types (newsletter, mailing-list,
 * group) they hold no grant for at all and whose own picker would come up empty. `writerGuard`
 * remains the actual authority regardless of what this list advertises — it only ever narrows
 * the affordance, it never grants access.
 *
 * Everything resolves to `[]` while loading and on error (the underlying service fails closed).
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

  private readonly writerEligibility: WritableSignal<CreatePickerResultSet> = signal(EMPTY_CREATE_PICKER_RESULT);

  /** True when a writer-only probe found at least one direct-grant project or committee. */
  private readonly hasWriterEligibleTarget: Signal<boolean> = computed(() => {
    const result = this.writerEligibility();
    return result.projects.length > 0 || result.committees.length > 0;
  });

  /** Artifact types offered to the user — all types when writer-eligible, else none (see class doc). */
  public readonly creatableTypes: Signal<CreatableArtifactType[]> = computed(() =>
    this.hasWriterEligibleTarget() ? CREATABLE_ARTIFACTS.map((artifact) => artifact.type) : []
  );

  /**
   * Always true — the rail button no longer gates on an eligibility probe (see class doc). Kept
   * as a signal (not a plain `true`) so existing consumers don't need to change, and so a future
   * cheap "does this user have anything at all" signal has somewhere to plug back in.
   */
  public readonly canShowCreateButton: Signal<boolean> = computed(() => true);

  public constructor() {
    // Deferred to after the first render — this probe is cheap (direct-grant only), but any
    // avoidable HTTP round trip during SSR still risks TTFB, so it stays off the critical render path.
    afterNextRender(() => {
      this.pickerService
        .getTree('newsletter')
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe((result) => this.writerEligibility.set(result));
    });
  }
}
