// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Lens, LensGrantInputs } from '../interfaces/lens.interface';

/**
 * The lenses a user is authorised to use, from their persona roles and `writer` grants.
 *
 * Two independent sources confer a lens, and either is sufficient:
 *  - a **persona role** — a board role reaches `foundation`, a project role reaches `project`,
 *    and a root writer reaches both.
 *  - a **`writer` grant** on a project of that kind (LFXV2-2754). Persona detection and FGA
 *    grants are independent, so delegated staff commonly hold `writer` on foundations while
 *    detecting as `contributor` only. Requiring the persona stranded them: every path that
 *    resolves a create target reads the lens, so a lens they could never hold made projects
 *    they demonstrably administer unreachable.
 *
 * `me` is always present. `org` is feature-flagged and independent of both sources.
 *
 * Extracted as a pure function so this authorisation-adjacent logic is unit-testable — the
 * Angular app has no unit-test runner, and `LensService` consumes this rather than
 * reimplementing it.
 */
export function deriveAllowedLenses(inputs: LensGrantInputs): Lens[] {
  const { hasBoardRole, hasProjectRole, isRootWriter, hasWriterFoundation, hasWriterProject, isOrgLensEnabled } = inputs;

  const showFoundation = hasBoardRole || isRootWriter || hasWriterFoundation;
  const showProject = hasProjectRole || isRootWriter || hasWriterProject;

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
