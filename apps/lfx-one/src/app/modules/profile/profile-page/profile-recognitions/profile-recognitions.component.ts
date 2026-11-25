// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, PLATFORM_ID, Signal, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { PROFILE_GRID_LIMIT, PROFILE_RECOGNITIONS_COPY, PROFILE_TRAINING_PATH } from '@lfx-one/shared/constants';
import { BadgeState, ProfileRecognitionItem } from '@lfx-one/shared/interfaces';
import { compareBadgesByIssuedDateDesc, formatYearMonth, isValidUrl } from '@lfx-one/shared/utils';
import { BadgesService } from '@services/badges.service';
import { ProfileGridComponent } from '@shared/components/profile-section/profile-grid.component';
import { ProfilePillComponent } from '@shared/components/profile-section/profile-pill.component';
import { ProfileSectionEmptyComponent } from '@shared/components/profile-section/profile-section-empty.component';
import { ProfileSectionHintComponent } from '@shared/components/profile-section/profile-section-hint.component';
import { ProfileSectionComponent } from '@shared/components/profile-section/profile-section.component';
import { UiBadgeComponent } from '@shared/uikit/badge/badge.component';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiNoteComponent } from '@shared/uikit/note/note.component';
import { UiSkeletonComponent } from '@shared/uikit/skeleton/skeleton.component';
import { catchError, map, of, startWith, switchMap } from 'rxjs';

/**
 * The Profile page's Recognitions section (#6084): the Credly badges the Badges page loads, as pills that link to Credly and
 * open a card with the description and issue date on hover or focus. Pending badges, not yet accepted, are left out.
 */
@Component({
  selector: 'lfx-profile-recognitions',
  imports: [
    ProfileGridComponent,
    ProfilePillComponent,
    ProfileSectionComponent,
    ProfileSectionEmptyComponent,
    ProfileSectionHintComponent,
    UiBadgeComponent,
    UiButtonComponent,
    UiNoteComponent,
    UiSkeletonComponent,
  ],
  templateUrl: './profile-recognitions.component.html',
})
export class ProfileRecognitionsComponent {
  // Private injections
  private readonly badgesService = inject(BadgesService);
  private readonly platformId = inject(PLATFORM_ID);

  protected readonly copy = PROFILE_RECOGNITIONS_COPY;
  protected readonly trainingPath = PROFILE_TRAINING_PATH;
  protected readonly skeletons = [0, 1, 2];

  // Simple WritableSignals
  protected readonly expanded = signal(false);
  private readonly reload = signal(0);

  // Complex computed/toSignal signals
  protected readonly state: Signal<BadgeState> = this.initState();
  /** Earned badges, newest first, each with a Credly link that is safe to open and its issue month. */
  protected readonly badges: Signal<ProfileRecognitionItem[]> = this.initBadges();
  protected readonly shown = computed(() => (this.expanded() ? this.badges() : this.badges().slice(0, PROFILE_GRID_LIMIT)));

  protected retry(): void {
    this.reload.update((count) => count + 1);
  }

  // Private initializer functions
  private initBadges(): Signal<ProfileRecognitionItem[]> {
    return computed(() =>
      this.state()
        .data.filter((badge) => !badge.isPending)
        .sort(compareBadgesByIssuedDateDesc)
        .map((badge) => ({
          badge,
          // Credly sends the link; only an http(s) one is opened.
          href: badge.credlyUrl && isValidUrl(badge.credlyUrl) ? badge.credlyUrl : null,
          issued: formatYearMonth(badge.issuedDate),
        }))
    );
  }

  // Browser only: the badges are the signed-in user's own, read like the Badges page reads them.
  private initState(): Signal<BadgeState> {
    const loading: BadgeState = { loading: true, error: false, data: [] };
    if (!isPlatformBrowser(this.platformId)) return signal(loading);
    return toSignal(
      toObservable(this.reload).pipe(
        switchMap(() =>
          this.badgesService.getBadges().pipe(
            map((data): BadgeState => ({ loading: false, error: false, data })),
            catchError((error: unknown) => {
              console.warn('[ProfileRecognitions] Failed to load badges', error);
              return of<BadgeState>({ loading: false, error: true, data: [] });
            }),
            startWith(loading)
          )
        )
      ),
      { initialValue: loading }
    );
  }
}
