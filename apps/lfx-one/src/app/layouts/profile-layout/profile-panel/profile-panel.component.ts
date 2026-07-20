// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, effect, input, output, signal } from '@angular/core';

/**
 * ProfilePanelComponent is the fixed right-hand panel of the Profile & Account hub.
 * It is purely presentational: all values arrive via signal inputs (sourced from the
 * parent ProfileLayoutComponent's CombinedProfile) and the edit affordances emit
 * `editRequested` so the parent — which owns the profile data, edit dialog, and
 * optimistic-update logic — handles the actual edit flow.
 *
 * Rows render only when their value is present. About me, GitHub, and LinkedIn are
 * stubbed for now (no source on CombinedProfile yet) and therefore stay hidden until
 * wired in a follow-up.
 */
@Component({
  selector: 'lfx-profile-panel',
  imports: [],
  templateUrl: './profile-panel.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfilePanelComponent {
  // Inputs — sourced from the parent's CombinedProfile-derived signals
  public readonly loading = input<boolean>(false);
  public readonly impersonating = input<boolean>(false);
  public readonly avatarUrl = input<string>('');
  public readonly displayName = input<string>('');
  public readonly initials = input<string>('U');
  public readonly username = input<string>('');
  public readonly aboutMe = input<string>('');
  public readonly jobTitle = input<string>('');
  public readonly organization = input<string>('');
  public readonly email = input<string>('');
  public readonly addressLines = input<string[]>([]);
  public readonly phone = input<string>('');
  public readonly tshirtSize = input<string>('');
  public readonly githubHandle = input<string>('');
  public readonly linkedinHandle = input<string>('');

  // Outputs
  public readonly editRequested = output<void>();

  // Tracks failed avatar image loads so we can fall back to initials
  public readonly avatarLoadError = signal<boolean>(false);

  public constructor() {
    // Reset the avatar error flag whenever the picture URL changes so a newly-set
    // (or refreshed) avatar re-attempts to load instead of staying on the initials fallback
    effect(() => {
      this.avatarUrl();
      this.avatarLoadError.set(false);
    });
  }

  // Editing acts on the real account and is blocked while impersonating.
  public onEdit(): void {
    if (this.impersonating()) {
      return;
    }
    this.editRequested.emit();
  }
}
