// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input } from '@angular/core';
import { PUBLIC_PROFILE_TOPBAR_COPY, PUBLIC_PROFILE_TOPBAR_REVEAL_OFFSET } from '@lfx-one/shared/constants';
import { UiAvatarComponent } from '@shared/uikit/avatar/avatar.component';
import { UiButtonComponent } from '@shared/uikit/button/button.component';

import { PublicProfileThemeService } from '../../services/public-profile-theme.service';
import { PublicProfileTopbarComponent } from '../public-profile-topbar/public-profile-topbar.component';

/**
 * The public profile top bar under the profile redesign (#6090). At rest it shows "Powered by LFX"; past 240px of scroll it
 * shows the LF tile, the person's photo, name and headline over a gradient fade. On the right are the theme toggle and, for
 * a visitor, Sign in and Create LFX account, or for the profile's owner, Manage my profile.
 */
@Component({
  selector: 'lfx-public-profile-topbar-redesign',
  imports: [UiAvatarComponent, UiButtonComponent],
  templateUrl: './public-profile-topbar-redesign.component.html',
})
export class PublicProfileTopbarRedesignComponent extends PublicProfileTopbarComponent {
  // Private injections
  protected readonly theme = inject(PublicProfileThemeService);

  /** The viewer is signed in as the person this profile belongs to. */
  public readonly owner = input<boolean>(false);
  /** The viewer is signed in. */
  public readonly signedIn = input<boolean>(false);
  /** Where signing in returns to: this profile. */
  public readonly returnTo = input<string>('/');

  protected readonly copy = PUBLIC_PROFILE_TOPBAR_COPY;
  protected override readonly revealOffset = PUBLIC_PROFILE_TOPBAR_REVEAL_OFFSET;

  // Creating an account starts from the same LF sign-in page, which offers it, and returns here either way.
  protected readonly signInUrl = computed(() => `/login?returnTo=${encodeURIComponent(this.returnTo())}`);
  protected readonly themeLabel = computed(() => (this.theme.dark() ? this.copy.lightTheme : this.copy.darkTheme));
}
