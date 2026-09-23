// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, inject } from '@angular/core';
import { UserService } from '@services/user.service';

/**
 * Logo + logout only. The product header pulls search, menus, and a profile fetch that
 * the invite landing does not need (GH-2290). Home and logout are full-page navigations
 * so the next load runs a normal bootstrap instead of an invite-skipped one.
 */
@Component({
  selector: 'lfx-invite-landing-header',
  templateUrl: './invite-landing-header.component.html',
})
export class InviteLandingHeaderComponent {
  protected readonly userService = inject(UserService);
}
