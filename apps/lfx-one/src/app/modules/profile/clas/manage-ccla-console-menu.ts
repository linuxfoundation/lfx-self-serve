// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { MyClaAgreement } from '@lfx-one/shared/interfaces';
import { canManageInCclaConsole, cclaConsoleUrl } from '@lfx-one/shared/utils';
import { MenuItem } from 'primeng/api';

import { environment } from '@environments/environment';

/**
 * Kebab item for Manage in CCLA Console (#1575).
 *
 * Returns `[]` when the caller is not a CLA manager, the row is ICLA/Revoked, or the CLA
 * group id is missing — safe to spread onto every row. Does not read LaunchDarkly.
 * Does not edit the Contact CLA Manager factory.
 *
 * Opens via `command` rather than `url` + `target`: PrimeNG's menu renders no `rel`
 * attribute, so an anchor here could not carry `noopener noreferrer`.
 *
 * Disabled while impersonating even though the item is a read plus a navigation. The Console
 * authenticates the browser's own user, so following it from an impersonation session lands the
 * administrator in the Console as themselves on someone else's project — an offer that does not
 * do what the row implies. Row actions grey out together (#1894); only Download PDF stays.
 */
export function buildManageInCclaConsoleMenuItems(agreement: MyClaAgreement, impersonating: boolean): MenuItem[] {
  if (!canManageInCclaConsole(agreement)) {
    return [];
  }
  const url = cclaConsoleUrl(environment.urls.corporateConsole, agreement.foundationSfid, agreement.projectSfid);
  return [
    {
      label: 'Manage in CCLA Console',
      icon: 'fa-light fa-arrow-up-right-from-square',
      disabled: impersonating,
      command: () => {
        if (typeof window !== 'undefined') {
          window.open(url, '_blank', 'noopener,noreferrer');
        }
      },
    },
  ];
}
