// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { orgKeyContactRolePillClass } from '@lfx-one/shared/utils';

/** Tailwind pill classes for a role string; falls back when upstream returns an unknown role. */
export function rolePillClass(role: string): string {
  return orgKeyContactRolePillClass(role);
}
