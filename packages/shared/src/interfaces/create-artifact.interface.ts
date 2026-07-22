// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ProjectContext } from './project.interface';

/**
 * Artifact types a permitted user can create from the rail "Create" quick-link.
 * Values map 1:1 to the existing creation routes (see `CREATABLE_ARTIFACTS`).
 */
export type CreatableArtifactType = 'meeting' | 'newsletter' | 'vote' | 'survey' | 'group' | 'mailing-list';

/**
 * Semantic grouping for the quick-link menu — the ordering rationale, not usage
 * frequency: Engage (Meeting, Newsletter), Decide (Vote, Survey), Organize
 * (Group, Mailing List). The popover draws a thin separator wherever consecutive
 * entries change group, so the grouping reads as deliberate. No group labels are
 * rendered yet — the field exists to drive separators and to anchor future labels.
 */
export type CreatableArtifactGroup = 'engage' | 'decide' | 'organize';

/**
 * Static, non-permission config for a creatable artifact type — drives the
 * type-selection rows in the rail "Create" popover, and the header of the
 * project-selection dialog that follows.
 */
export interface CreatableArtifactConfig {
  /** Stable identifier used for filtering, routing, and test ids. */
  type: CreatableArtifactType;
  /** Row title, e.g. "Meeting". */
  label: string;
  /** Supporting copy describing what the type is for. */
  description: string;
  /** Font Awesome icon class, e.g. 'fa-light fa-calendar'. */
  icon: string;
  /** Absolute route to the existing creation flow, e.g. '/meetings/create'. */
  createRoute: string;
  /** Semantic group this entry belongs to; a change between adjacent entries draws a menu separator. */
  group: CreatableArtifactGroup;
  /**
   * Which target kinds this artifact type can be created against. A committee-writer-only
   * user is only offered types whose `targetKinds` includes `'committee'` — mirrors the
   * `writerGuard`'s `supportsCommitteeWriter` list (meetings/surveys/votes). Types not in
   * that list (newsletter, group, mailing-list) require an actual project/foundation writer
   * grant, since creating a *new* group is itself a project-writer operation.
   */
  targetKinds: CreatableTargetKind[];
}

/**
 * A project/foundation the current user is permitted to create a given artifact
 * type on. Extends `ProjectContext` so it can be passed straight to
 * `ProjectContextService.setProject()` / `setFoundation()` before navigation.
 */
export interface CreatableProject extends ProjectContext {
  /**
   * View-only, not part of any API payload: computed client-side by `computeIsFoundation()`
   * from the project's own attributes. True when this context is a top-level foundation,
   * which dispatches the selection to `setFoundation()` vs `setProject()` and selects the
   * lens to align before navigating.
   */
  isFoundation: boolean;
}

/** Discriminator for a create-target selector entry — a project/foundation or a committee. */
export type CreatableTargetKind = 'project' | 'committee';

/**
 * A committee (Group) the current user is permitted to create meetings/votes/surveys
 * against, sourced from a `writer === true` grant on `GET /api/committees`. Carries the
 * owning project's slug/uid so navigation can seed `?project=<projectSlug>` alongside
 * `?committee_uid=<uid>` — the create pages resolve `project_uid` from the seeded slot,
 * falling back to `projectUid` directly when the caller has no independent project-viewer
 * relation (see the committee-only writer fallback on the meeting/vote/survey create pages).
 */
export interface CreatableCommittee {
  /** Committee UID. */
  uid: string;
  name: string;
  logoUrl?: string;
  /** Owning project's UID — used as a fallback when the project slot isn't seeded. */
  projectUid: string;
  /** Owning project's URL slug — carried as `?project=` to seed the create-flow slot. */
  projectSlug: string;
  projectName: string;
  /** Whether the owning project is a foundation (top-level entity). */
  isFoundation: boolean;
}

/**
 * A create-target selector entry — either a project/foundation grant or a committee grant.
 * `kind` discriminates which shape follows so the dialog and navigation code can branch
 * without an `instanceof`/duck-typing check.
 */
export type CreatableTarget = ({ kind: 'project' } & CreatableProject) | ({ kind: 'committee' } & CreatableCommittee);
