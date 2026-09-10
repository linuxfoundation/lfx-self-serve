// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { AvatarComponent } from '@components/avatar/avatar.component';
import { ButtonComponent } from '@components/button/button.component';
import {
  LFX_PROFILE_CARD_EDIT_LABEL,
  LFX_PROFILE_CARD_EMPTY,
  LFX_PROFILE_CARD_LABELS,
  LFX_PROFILE_CARD_PRIMARY_BADGE,
  LFX_PROFILE_CARD_SUBTITLE,
  LFX_PROFILE_CARD_TITLE,
} from '@lfx-one/shared/constants';
import { EnrichedIdentity, LfxProfileSummary } from '@lfx-one/shared/interfaces';
import { buildLfxProfileSummary } from '@lfx-one/shared/utils';
import { UserService } from '@services/user.service';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, forkJoin, map, Observable, of } from 'rxjs';

import { MentorshipComingSoonService } from '../../services/mentorship-coming-soon.service';

/**
 * Read-only summary of the signed-in user's LFX profile, shown above the mentorship
 * registration forms so the applicant can see what the program admin will receive
 * without retyping any of it. Nothing here is editable: the profile is the system of
 * record, and the button will send the user there once that navigation is wired up.
 * Today it raises the module's coming-soon toast.
 *
 * The card owns its own fetch rather than taking the data as an input, so it can be
 * dropped onto any mentorship form without that page learning about three profile
 * endpoints.
 */
@Component({
  selector: 'lfx-mentorship-profile-card',
  imports: [AvatarComponent, ButtonComponent, SkeletonModule],
  templateUrl: './profile-card.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfileCardComponent {
  private readonly userService = inject(UserService);
  private readonly comingSoon = inject(MentorshipComingSoonService);

  protected readonly title = LFX_PROFILE_CARD_TITLE;
  protected readonly subtitle = LFX_PROFILE_CARD_SUBTITLE;
  protected readonly editLabel = LFX_PROFILE_CARD_EDIT_LABEL;
  protected readonly primaryBadge = LFX_PROFILE_CARD_PRIMARY_BADGE;
  protected readonly placeholder = LFX_PROFILE_CARD_EMPTY;
  protected readonly labels = LFX_PROFILE_CARD_LABELS;
  /** One skeleton row per field the loaded card will show, so the placeholder matches its height. */
  protected readonly loadingRows = Object.keys(LFX_PROFILE_CARD_LABELS);

  /** Null only while the three requests are still in flight — see `initSummary`. */
  protected readonly summary = this.initSummary();

  /**
   * The profile's own picture, falling back to the session's avatar the way the sidebar
   * and header do. Without the fallback this card would show initials for a user whose
   * photo comes from the OIDC claim rather than an LFX upload — the same person, with a
   * photo two panels away.
   */
  protected readonly avatarUrl = computed(() => this.summary()?.avatarUrl || this.userService.effectiveAvatarUrl());

  protected onEdit(): void {
    this.comingSoon.notify(this.editLabel);
  }

  /**
   * Name, emails, and linked accounts live behind three separate endpoints, so fetch
   * them together and let each one fail on its own. A partial outage should cost the
   * user the affected rows, not the whole card — `buildLfxProfileSummary` fills the
   * gaps, and the template renders a placeholder per field.
   *
   * Each fallback logs before it degrades: the card looks the same whether a field is
   * genuinely blank or its endpoint is down, so without this an outage is invisible.
   */
  private initSummary() {
    return toSignal<LfxProfileSummary | null>(
      forkJoin({
        combined: this.userService.getCurrentUserProfile().pipe(catchError((error) => this.degrade('profile', error, null))),
        emails: this.userService.getUserEmails().pipe(catchError((error) => this.degrade('emails', error, null))),
        identities: this.userService.getIdentities().pipe(catchError((error) => this.degrade('identities', error, [] as EnrichedIdentity[]))),
      }).pipe(map(({ combined, emails, identities }) => buildLfxProfileSummary(combined, emails, identities))),
      { initialValue: null }
    );
  }

  /** Records which of the three sources dropped out, then yields its per-field fallback. */
  private degrade<T>(source: string, error: unknown, fallback: T): Observable<T> {
    console.error(`mentorship-profile-card: ${source} fetch failed, rendering placeholders for those fields`, error);
    return of(fallback);
  }
}
