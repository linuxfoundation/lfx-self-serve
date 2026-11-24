// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { inject, Injectable } from '@angular/core';
import { CombinedProfile, UserMetadata } from '@lfx-one/shared/interfaces';
import { buildDisplayName, buildMentorshipLfxProfileFields } from '@lfx-one/shared/utils';

import { MentorshipService } from './mentorship.service';
import { UserService } from './user.service';

/**
 * Carries a just-saved profile change to the rest of the app: the name in the navbar, the avatar and the user's Mentorship
 * profiles. Shared by the Profile & Account hub and the Account & Settings Personal information page (#6072).
 */
@Injectable({ providedIn: 'root' })
export class ProfileSaveSyncService {
  private readonly userService = inject(UserService);
  private readonly mentorshipService = inject(MentorshipService);

  /** Applies every sync for one save. `savedUser` is the account as it was before this save. */
  public apply(metadata: Partial<UserMetadata>, savedUser: CombinedProfile['user'] | null | undefined): void {
    this.syncMentorshipProfiles(metadata, savedUser);
    this.syncSharedUserName(metadata, savedUser);
    // The home sidebar and header read the shared avatar, not a page's own profile, so a fresh upload shows there at once.
    if (metadata.picture) this.userService.uploadedAvatarUrl.set(metadata.picture);
  }

  /**
   * The navbar and account popover read `UserService.user().name`, which is seeded once from the SSR OIDC claims and never
   * refetched, so a saved name change is pushed into it for the current session.
   */
  public syncSharedUserName(metadata: Partial<UserMetadata>, savedUser: CombinedProfile['user'] | null | undefined): void {
    const currentUser = this.userService.user();
    if (!currentUser || this.userService.impersonating() || (metadata.given_name === undefined && metadata.family_name === undefined)) {
      return;
    }

    const givenName = metadata.given_name ?? savedUser?.first_name ?? '';
    const familyName = metadata.family_name ?? savedUser?.last_name ?? '';
    if (buildDisplayName(givenName, familyName)) {
      // `saved` latches the name so the post-hydration profile fetch can't overwrite it with a stale
      // body — even when the name is already the one shown, so this must not be skipped on equality.
      this.userService.applyDisplayName(givenName, familyName, true);
    }
  }

  /**
   * Copies a new picture or name onto the user's mentor and mentee profiles, which Mentorship shows ahead of the LFX profile
   * (linuxfoundation/lfx-mentorship#466). A name is sent only when it differs from `savedUser`'s; with no profile loaded yet it
   * is sent as saved. The picture is sent only when this save uploaded one, so an unchanged save never replaces a photo kept in
   * Mentorship with the avatar shown here.
   *
   * Copies are queued on `MentorshipService`, which sends them one at a time in save order, so a quick second save cannot be
   * overtaken by the first. The BFF does nothing for a user with no mentorship record. A failure is only logged, since the
   * LFX profile did save.
   */
  public syncMentorshipProfiles(metadata: Partial<UserMetadata>, savedUser: CombinedProfile['user'] | null | undefined): void {
    if (this.userService.impersonating()) return;

    const fields = buildMentorshipLfxProfileFields({
      firstName: metadata.given_name !== savedUser?.first_name ? metadata.given_name : undefined,
      lastName: metadata.family_name !== savedUser?.last_name ? metadata.family_name : undefined,
      logoUrl: metadata.picture,
    });
    if (Object.keys(fields).length === 0) return;

    this.mentorshipService.queueLfxProfileSync(fields);
  }
}
