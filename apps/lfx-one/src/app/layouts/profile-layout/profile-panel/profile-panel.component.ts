// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';

/**
 * ProfilePanelComponent is the sticky right-hand panel of the Profile & Account hub
 * (a sticky side column at 2xl, stacked full-width above the content below that).
 * It is purely presentational: all values arrive via signal inputs (sourced from the
 * parent ProfileLayoutComponent's CombinedProfile) and the edit affordances emit
 * `editRequested` so the parent — which owns the profile data, edit dialog, and
 * optimistic-update logic — handles the actual edit flow.
 *
 * Rows render only when their value is present. GitHub is sourced from the user's
 * connected identities (bound by the parent); About me and LinkedIn are stubbed for now
 * (no source yet) and therefore stay hidden until wired in a follow-up.
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

  // The avatar URL that failed to load, if any. Tracking the URL (rather than a plain boolean)
  // lets a newly-set/refreshed picture re-attempt to load without an effect(): once avatarUrl
  // changes, it no longer matches the errored URL, so showAvatarImage flips back to true.
  private readonly avatarErrorUrl = signal<string | null>(null);

  // Show the picture when we have a URL that hasn't errored; otherwise fall back to initials.
  public readonly showAvatarImage = computed(() => {
    const url = this.avatarUrl();
    return !!url && this.avatarErrorUrl() !== url;
  });

  /**
   * Request the profile edit flow from the parent. No-op while impersonating, since
   * profile edits act on the real account and are blocked server-side.
   */
  public onEdit(): void {
    if (this.impersonating()) {
      return;
    }
    this.editRequested.emit();
  }

  /**
   * Handle a failed avatar image load: record the errored URL so `showAvatarImage`
   * turns false and the initials fallback renders until the URL changes.
   */
  public onAvatarError(): void {
    this.avatarErrorUrl.set(this.avatarUrl());
  }
}
