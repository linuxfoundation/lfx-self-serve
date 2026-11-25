// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ACCOUNT_SETTINGS_NAV } from '@lfx-one/shared/constants';
import { AccountSettingsNavGroup } from '@lfx-one/shared/interfaces';

/** The Account & Settings landing page (#6069): every page under its group, with an icon tile and a one-line description. */
@Component({
  selector: 'lfx-account-landing',
  imports: [RouterLink],
  templateUrl: './account-landing.component.html',
})
export class AccountLandingComponent {
  protected readonly navGroups: AccountSettingsNavGroup[] = ACCOUNT_SETTINGS_NAV;
}
