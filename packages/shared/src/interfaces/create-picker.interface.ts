// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CreatableArtifactType } from './create-artifact.interface';

/**
 * A selectable project row in the create picker's tree/search results.
 */
export interface CreatePickerProjectNode {
  kind: 'project';
  uid: string;
  name: string;
  slug: string;
  /** Drives `setFoundation()` vs `setProject()` and the `/foundation/` vs `/project/` route prefix. */
  isFoundation: boolean;
}

/**
 * A selectable committee row in the create picker's tree/search results. Only present when the
 * requested `artifactType` allows a committee-scoped writer to create against it (see
 * `COMMITTEE_WRITE_ARTIFACT_TYPES`).
 */
export interface CreatePickerCommitteeNode {
  kind: 'committee';
  uid: string;
  name: string;
  projectUid: string;
  /** For the `?project=<slug>` query param and search-result breadcrumbs. */
  projectSlug: string;
  projectName: string;
  /** Resolved from the committee's own associated project — see `CreatePickerProjectNode.isFoundation`. */
  isFoundation: boolean;
}

export type CreatePickerNode = CreatePickerProjectNode | CreatePickerCommitteeNode;

/**
 * Shared response shape for all three create-picker endpoints (top-level tree, lazy children,
 * and search) — always a flat pair of project/committee rows, never pre-nested. The client owns
 * tree structure (which rows are whose children) via `CreatePickerCommitteeNode.projectUid` and
 * the request that fetched them.
 */
export interface CreatePickerResultSet {
  projects: CreatePickerProjectNode[];
  committees: CreatePickerCommitteeNode[];
}

export interface CreatePickerChildrenQuery {
  parentType: 'project' | 'committee';
  parentUid: string;
  artifactType: CreatableArtifactType;
}
