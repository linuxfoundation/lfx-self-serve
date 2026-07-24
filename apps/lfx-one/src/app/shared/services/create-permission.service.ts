// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, Injectable, Signal } from '@angular/core';
import { CREATABLE_ARTIFACTS } from '@lfx-one/shared/constants';
import { CreatableArtifactType } from '@lfx-one/shared/interfaces';

/**
 * Decides which artifact types the rail "Create" quick-link offers — LFXV2-2838.
 *
 * Both signals below are unconditional: neither the rail button nor its menu gates on any
 * eligibility probe anymore. Earlier versions of this service sourced both from the create
 * picker's direct-grant-only `GET /api/create-picker/tree`, but that hides the button (or, once
 * the button itself was fixed to always show, still emptied the menu behind it) for a pure
 * inherited-writer or committee-only-grant user — exactly the class of user this ticket's picker
 * rebuild exists to serve, since their only path to a target is the picker's own search, which
 * they could never reach if the button — or every item in its menu — stayed hidden.
 *
 * The create-target picker's own fail-closed empty state (tree and search both empty) is what
 * communicates zero access now, for whichever artifact type the user actually opens. `writerGuard`
 * remains the actual authority regardless of what this menu advertises — it only ever narrows the
 * affordance, it never grants access. There is no probe left to run, so this service has no
 * constructor, no injected dependencies, and does no I/O.
 */
@Injectable({
  providedIn: 'root',
})
export class CreatePermissionService {
  /** Always all six creatable types (see class doc). */
  public readonly creatableTypes: Signal<CreatableArtifactType[]> = computed(() => CREATABLE_ARTIFACTS.map((artifact) => artifact.type));

  /** Always true (see class doc). */
  public readonly canShowCreateButton: Signal<boolean> = computed(() => true);
}
