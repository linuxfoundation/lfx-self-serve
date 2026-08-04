// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { Component, computed, inject, PLATFORM_ID, Signal, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { CardComponent } from '@components/card/card.component';
import { HeaderComponent } from '@components/header/header.component';
import { MarkdownRendererComponent } from '@components/markdown-renderer/markdown-renderer.component';
import { PublicProfile } from '@lfx-one/shared/interfaces';
import { PublicProfileService } from '@services/public-profile.service';
import { UserService } from '@services/user.service';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, distinctUntilChanged, filter, map, of, switchMap } from 'rxjs';

import { PublicProfileBadgesComponent } from '../components/public-profile-badges/public-profile-badges.component';
import { PublicProfileCertificationsComponent } from '../components/public-profile-certifications/public-profile-certifications.component';
import { PublicProfileCommunitiesComponent } from '../components/public-profile-communities/public-profile-communities.component';
import { PublicProfileContributionsComponent } from '../components/public-profile-contributions/public-profile-contributions.component';
import { PublicProfileEventsComponent } from '../components/public-profile-events/public-profile-events.component';
import { PublicProfileHeroComponent } from '../components/public-profile-hero/public-profile-hero.component';
import { PublicProfileTrainingsComponent } from '../components/public-profile-trainings/public-profile-trainings.component';

@Component({
  selector: 'lfx-public-profile-page',
  imports: [
    HeaderComponent,
    CardComponent,
    MarkdownRendererComponent,
    SkeletonModule,
    PublicProfileHeroComponent,
    PublicProfileContributionsComponent,
    PublicProfileCommunitiesComponent,
    PublicProfileBadgesComponent,
    PublicProfileCertificationsComponent,
    PublicProfileTrainingsComponent,
    PublicProfileEventsComponent,
  ],
  templateUrl: './public-profile-page.component.html',
})
export class PublicProfilePageComponent {
  private readonly activatedRoute = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly userService = inject(UserService);
  private readonly publicProfileService = inject(PublicProfileService);
  private readonly platformId = inject(PLATFORM_ID);

  protected readonly authenticated = this.userService.authenticated;
  protected readonly loading = signal(true);
  protected readonly error = signal(false);

  protected readonly profile: Signal<PublicProfile | null> = this.initProfile();

  // Section slices — each section is hidden when its slice is empty.
  protected readonly basic = computed(() => this.profile()?.basic ?? null);
  protected readonly about = computed(() => this.profile()?.About?.trim() || '');
  protected readonly technicalContribution = computed(() => this.profile()?.technical_contribution ?? null);
  protected readonly communityRoles = computed(() => this.profile()?.community_roles ?? []);
  protected readonly badges = computed(() => this.profile()?.badges ?? []);
  protected readonly certifications = computed(() => this.profile()?.certification_activities ?? []);
  protected readonly trainings = computed(() => this.profile()?.training_activities ?? []);
  protected readonly events = computed(() => this.profile()?.event_activities ?? []);

  protected readonly hasContributions = computed(() => (this.technicalContribution()?.projects?.length ?? 0) > 0);
  protected readonly hasCommunities = computed(() => this.communityRoles().length > 0);
  protected readonly hasBadges = computed(() => this.badges().length > 0);
  protected readonly hasCertifications = computed(() => this.certifications().length > 0);
  protected readonly hasTrainings = computed(() => this.trainings().length > 0);
  protected readonly hasEvents = computed(() => this.events().length > 0);

  protected navigateToLogin(): void {
    if (isPlatformBrowser(this.platformId)) {
      window.location.href = `/login?returnTo=${encodeURIComponent(window.location.pathname)}`;
    }
  }

  private initProfile(): Signal<PublicProfile | null> {
    return toSignal(
      this.activatedRoute.paramMap.pipe(
        map((params) => params.get('username')),
        filter((username): username is string => !!username),
        distinctUntilChanged(),
        switchMap((username) => {
          this.loading.set(true);
          this.error.set(false);
          return this.publicProfileService.getPublicProfile(username).pipe(
            map((profile) => {
              // Private profiles respond 200 with only `{ isPublic: false }` — treat as not-found.
              if (!profile?.isPublic) {
                this.loading.set(false);
                this.router.navigate(['/u/not-found'], { queryParams: { reason: 'private' } });
                return null;
              }
              return profile;
            }),
            catchError((err) => {
              const status = err?.status;
              if (typeof status === 'number' && [400, 404].includes(status)) {
                this.router.navigate(['/u/not-found']);
              } else {
                this.error.set(true);
              }
              this.loading.set(false);
              return of(null);
            })
          );
        }),
        map((profile) => {
          if (profile) {
            this.loading.set(false);
          }
          return profile;
        })
      ),
      { initialValue: null }
    );
  }
}
