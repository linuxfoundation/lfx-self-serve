// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { OrgProjectScope } from '@lfx-one/shared/interfaces';

/** `AND`-prefixed SQL predicate for a project scope over a boolean LF flag column (`''` for `all`). Inlined, not bound: the scope is allow-listed. */
export function orgProjectScopePredicate(scope: OrgProjectScope, column = 'is_lf_project'): string {
  switch (scope) {
    case 'lf':
      return `AND ${column} = TRUE`;
    case 'non_lf':
      return `AND ${column} = FALSE`;
    case 'all':
      return '';
  }
}
