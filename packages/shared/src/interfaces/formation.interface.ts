// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FormationItemActionType, FormationItemOwnerTeam, FormationTemplateSection } from '../enums';

/** A sub-step of a formation checklist item (e.g. the chat workspace's IT setup steps). */
export interface FormationTemplateSubItem {
  readonly id: string;
  readonly title: string;
  readonly ownerTeam: FormationItemOwnerTeam;
}

/** A single row of the seeded formation checklist template. */
export interface FormationTemplateItem {
  readonly id: string;
  readonly title: string;
  readonly section: FormationTemplateSection;
  readonly ownerTeam: FormationItemOwnerTeam;
  readonly actionType: FormationItemActionType;
  /** True only on legal/entity items that gate the formation's transition to Active. */
  readonly gate: boolean;
  readonly subItems?: readonly FormationTemplateSubItem[];
}

/** The seeded checklist template applied to every new project formation. */
export interface FormationTemplate {
  readonly id: string;
  /**
   * Bump whenever items/gates/sections change. Persisted formations (#1957) reference
   * (id, version) to reconstruct the exact checklist they were created against, so a content
   * edit without a version bump makes two different checklists indistinguishable.
   */
  readonly version: number;
  readonly items: readonly FormationTemplateItem[];
}
