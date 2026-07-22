// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Lens, LensGrantInputs } from '../interfaces/lens.interface';

/**
 * The lenses a user is authorised to use, from their persona roles alone.
 *
 * A board role reaches `foundation`, a project role reaches `project`, and a root writer
 * reaches both. `writer` grants no longer factor in here (LFXV2-2754 introduced a
 * `writer`-derived widening as a stopgap so delegated staff holding `writer` on a project their
 * persona didn't cover weren't stranded; LFXV2-2755 removed the need for it by making the create
 * flow navigate via explicit target selection, resolved independently of the active lens — see
 * `CreatePermissionService` and `project-context.service.ts`'s `routeLensKind` precedence).
 *
 * `me` is always present. `org` is feature-flagged and independent of persona.
 *
 * Extracted as a pure function so this authorisation-adjacent logic is unit-testable — the
 * Angular app has no unit-test runner, and `LensService` consumes this rather than
 * reimplementing it.
 */
export function deriveAllowedLenses(inputs: LensGrantInputs): Lens[] {
  const { hasBoardRole, hasProjectRole, isRootWriter, isOrgLensEnabled } = inputs;

  const showFoundation = hasBoardRole || isRootWriter;
  const showProject = hasProjectRole || isRootWriter;

  const lenses: Lens[] = ['me'];
  if (showFoundation) {
    lenses.push('foundation');
  }
  if (showProject) {
    lenses.push('project');
  }
  if (isOrgLensEnabled) {
    lenses.push('org');
  }
  return lenses;
}
