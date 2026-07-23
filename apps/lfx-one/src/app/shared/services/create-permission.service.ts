// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, inject, Injectable, Signal } from '@angular/core';
import { CREATABLE_ARTIFACTS } from '@lfx-one/shared/constants';
import { CreatableArtifactType, CreatableCommittee, CreatableProject } from '@lfx-one/shared/interfaces';
import { CommitteeWriterGrantsService } from '@services/committee-writer-grants.service';
import { WriterGrantsService } from '@services/writer-grants.service';

/**
 * Decides whether the rail "Create" quick-link (and which artifact types) is
 * offered to the current user, and which projects/foundations/committees they may target.
 *
 * Eligibility is composed from two independent `writer` grants, and nothing else — the same
 * signals `writerGuard` enforces:
 *  - Project/foundation `writer`, via {@link WriterGrantsService} (`GET /api/projects`).
 *  - Committee (Group) `writer`, via {@link CommitteeWriterGrantsService} (`GET /api/committees`).
 *
 * This list was previously intersected with the lenses the user's persona holds, on the
 * reasoning that `ProjectContextService.activeContext` is lens-gated so an unreachable lens
 * would dead-end at "Create". That was true, but it made the wrong side give way: it silently
 * hid projects the user provably administers. A user holding `writer` on 81 foundations while
 * detecting as `contributor` could target none of them (LFXV2-2754). LFXV2-2755 removes the
 * coupling at its root instead: the create dialog navigates by explicit selection
 * (`?project=<slug>` / `?committee_uid=<uid>`), which the create-route guards resolve
 * independently of the active lens — so `LensService` reverts to deriving lenses from persona
 * alone, and this list no longer needs to align a lens at all. Do not reintroduce a
 * persona-derived filter here; persona and `writer` are independent, and `writer` is the one
 * that confers authority.
 *
 * Everything resolves to `[]` while loading and on error, keeping the rail button hidden until
 * eligibility is proven — fail closed. The error half of that relies on the two grants services'
 * upstream calls catching internally and emitting `[]`.
 *
 * Granularity note: `writer` is not the whole story upstream. Meetings are broader still
 * (`meeting_coordinator` also qualifies, beyond project-writer and committee-writer), so users
 * holding only that role are still under-shown. This is a UX affordance only — the create
 * routes' `writerGuard` remains authoritative for non-ED personas, so the button never grants
 * access, it only advertises it. A `GET /api/projects/creatable` endpoint encoding the full
 * per-type grants (LFXV2-2753) is what would close that remaining gap.
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
  private readonly committeeWriterGrantsService = inject(CommitteeWriterGrantsService);

  /** Projects the user may create on — exactly those they hold `writer` on (see class doc). */
  public readonly creatableProjects: Signal<CreatableProject[]> = this.writerGrantsService.writerProjects;

  /** Committees (Groups) the user may create meetings/votes/surveys against. */
  public readonly creatableCommittees: Signal<CreatableCommittee[]> = this.committeeWriterGrantsService.writerCommittees;

  /**
   * Artifact types offered to the user — a genuine per-target-kind subset, not all-or-nothing.
   *
   * A type is offered iff the user holds at least one target of a `kind` listed in that type's
   * `targetKinds` (see `CREATABLE_ARTIFACTS`). A committee-only writer (no project/foundation
   * `writer` grant at all) is offered meeting/vote/survey only; a project/foundation writer is
   * offered all six. This is what makes `lens-switcher`'s `creatableArtifacts` filter meaningful
   * rather than a no-op.
   */
  public readonly creatableTypes: Signal<CreatableArtifactType[]> = computed(() => {
    const hasProjectTarget = this.creatableProjects().length > 0;
    const hasCommitteeTarget = this.creatableCommittees().length > 0;

    return CREATABLE_ARTIFACTS.filter(
      (artifact) => (hasProjectTarget && artifact.targetKinds.includes('project')) || (hasCommitteeTarget && artifact.targetKinds.includes('committee'))
    ).map((artifact) => artifact.type);
  });

  /** True when the user can create on at least one project or committee. */
  public readonly canShowCreateButton: Signal<boolean> = computed(() => this.creatableProjects().length > 0 || this.creatableCommittees().length > 0);
}
