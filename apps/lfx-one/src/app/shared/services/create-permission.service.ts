// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, inject, Injectable, Signal } from '@angular/core';
import { CREATABLE_ARTIFACTS } from '@lfx-one/shared/constants';
import { CreatableArtifactType, CreatableProject } from '@lfx-one/shared/interfaces';
import { WriterGrantsService } from '@services/writer-grants.service';

/**
 * Decides whether the rail "Create" quick-link (and which artifact types) is
 * offered to the current user, and which projects/foundations they may target.
 *
 * Eligibility is the project `writer` grant, and nothing else — the same signal
 * `writerGuard` enforces. `GET /api/projects` batch access-checks every visible
 * project and returns `writer` per project, so this reflects real per-project
 * authorization rather than inferring it from a persona.
 *
 * This list was previously intersected with the lenses the user's persona holds,
 * on the reasoning that `ProjectContextService.activeContext` is lens-gated so an
 * unreachable lens would dead-end at "Create". That was true, but it made the wrong
 * side give way: it silently hid projects the user provably administers. A user
 * holding `writer` on 81 foundations while detecting as `contributor` could target
 * none of them (LFXV2-2754). The lens is now derived from the grant instead —
 * `LensService.getAllowedLensIds` admits any lens the user holds `writer` within —
 * so alignment succeeds for exactly the projects listed here and the intersection
 * is redundant. Do not reintroduce a persona-derived filter on this list; persona
 * and `writer` are independent, and `writer` is the one that confers authority.
 *
 * Everything resolves to `[]` while loading and on error, keeping the rail button
 * hidden until eligibility is proven — fail closed. The error half of that relies on
 * `ProjectService.getProjects()` catching internally and emitting `[]`.
 *
 * Granularity note: `writer` is not the whole story upstream. Meetings are broader
 * (`meeting_coordinator` and committee-writer also qualify), so users holding only
 * those roles are still under-shown — they source no project `writer` at all, so the
 * client cannot see them. This is a UX affordance only — the create routes'
 * `writerGuard` remains authoritative for non-ED personas, so the button never grants
 * access, it only advertises it. A `GET /api/projects/creatable` endpoint encoding the
 * per-type grants (LFXV2-2753) is what closes that remaining gap.
 *
 * Persona note (ED): gating is purely the FGA `writer` relation, with NO ED fast-path —
 * unlike `writerGuard`, which synchronously allows the `executive-director` persona
 * because an ED is not reliably granted a per-project `writer` relation. So an ED whose
 * `GET /api/projects` returns no `writer: true` project sees no "Create" shortcut at all.
 * This is an accepted trade-off (LFXV2-2721): the shortcut is deliberately a writer-scoped
 * affordance, and EDs still create through the in-page flows, which carry their own ED
 * fast-path. Reinstating the button for those EDs would mean sourcing their foundations
 * from persona/lens data — the writer-scoped list is empty for them — which loosens the
 * writer filter this feature is scoped to; out of scope here by design.
 */
@Injectable({
  providedIn: 'root',
})
export class CreatePermissionService {
  private readonly writerGrantsService = inject(WriterGrantsService);

  /** Projects the user may create on — exactly those they hold `writer` on (see class doc). */
  public readonly creatableProjects: Signal<CreatableProject[]> = this.writerGrantsService.writerProjects;

  /**
   * Artifact types offered to the user — all types when they can create anywhere, else none.
   *
   * All-or-nothing by design: a `writer` grant is not per-type, so every type is offered together.
   * A new `CREATABLE_ARTIFACTS` entry therefore inherits visibility for free — it does NOT get
   * independent gating. Do not assume adding a type here narrows who sees it. The per-type
   * intersection this feeds (`lens-switcher`'s `creatableArtifacts` filter) is consequently a
   * no-op today; it exists so the switcher stays correct if a future `GET /api/projects/creatable`
   * endpoint makes this list a genuine per-type subset (see class doc).
   */
  public readonly creatableTypes: Signal<CreatableArtifactType[]> = computed(() =>
    this.creatableProjects().length > 0 ? CREATABLE_ARTIFACTS.map((artifact) => artifact.type) : []
  );

  /** True when the user can create on at least one project. */
  public readonly canShowCreateButton: Signal<boolean> = computed(() => this.creatableProjects().length > 0);
}
