// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Formation, FormationEntityType } from '../interfaces/formation.interface';

/**
 * Derives the Formations queue's Type-column taxonomy from the two inputs the formation service
 * serves (#1957, GH-2163 §1) — confirmed 8 Sep as "nothing stored, and we can derive." Never
 * store the result; call this wherever {@link FormationEntityType} is needed.
 *
 * `parent_uid` must already be `null` for a top-level project, not the hidden `ROOT` project's
 * UID — see {@link Formation.parent_uid}'s doc comment for why. The check below is deliberately
 * falsy (`!formation.parent_uid`), not a strict `=== null`, matching this repo's existing
 * ROOT-collapse precedent (`public-meeting.controller.ts`'s `!project.parent_uid` check) — a
 * producer that omits the key (`undefined`) or sends an un-collapsed empty string must not
 * silently fall through to `child_project` just because it wrote the wrong falsy value. A caller
 * getting `child_project` for a project it knows is top-level means the producer sent a real,
 * non-empty UID (the un-normalized ROOT case), not that this function is wrong.
 */
export function deriveFormationEntityType(formation: Pick<Formation, 'is_foundation' | 'parent_uid'>): FormationEntityType {
  if (formation.is_foundation) {
    return 'foundation';
  }
  if (!formation.parent_uid) {
    return 'project';
  }
  return 'child_project';
}
