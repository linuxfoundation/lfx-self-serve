// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { OrgLensRowOrganization } from '@lfx-one/shared/interfaces';

/** A roll-up row's organizations as one comma-separated line; null when the row names none (always, outside a roll-up). */
export function organizationNames(organizations: readonly OrgLensRowOrganization[] | undefined): string | null {
  return organizations?.length ? organizations.map((organization) => organization.name).join(', ') : null;
}
