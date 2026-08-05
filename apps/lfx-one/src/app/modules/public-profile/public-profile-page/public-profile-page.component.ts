// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterNextRender, Component, computed, inject, Signal, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { PublicProfile } from '@lfx-one/shared/interfaces';
import { OsanoService } from '@services/osano.service';
import { PublicProfileService } from '@services/public-profile.service';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, distinctUntilChanged, filter, map, of, switchMap } from 'rxjs';

import { PublicProfileBadgesComponent } from '../components/public-profile-badges/public-profile-badges.component';
import { PublicProfileCertificationsComponent } from '../components/public-profile-certifications/public-profile-certifications.component';
import { PublicProfileContributionsComponent } from '../components/public-profile-contributions/public-profile-contributions.component';
import { PublicProfileHeroComponent } from '../components/public-profile-hero/public-profile-hero.component';
import { PublicProfileTopbarComponent } from '../components/public-profile-topbar/public-profile-topbar.component';
import { PublicProfileTrainingsComponent } from '../components/public-profile-trainings/public-profile-trainings.component';

@Component({
  selector: 'lfx-public-profile-page',
  imports: [
    SkeletonModule,
    PublicProfileTopbarComponent,
    PublicProfileHeroComponent,
    PublicProfileContributionsComponent,
    PublicProfileBadgesComponent,
    PublicProfileCertificationsComponent,
    PublicProfileTrainingsComponent,
  ],
  templateUrl: './public-profile-page.component.html',
})
export class PublicProfilePageComponent {
  private readonly activatedRoute = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly publicProfileService = inject(PublicProfileService);
  private readonly osanoService = inject(OsanoService);

  protected readonly loading = signal(true);
  protected readonly error = signal(false);

  protected readonly profile: Signal<PublicProfile | null> = this.initProfile();

  // Section slices — each section is hidden when its slice is empty.
  protected readonly basic = computed(() => this.profile()?.basic ?? null);
  protected readonly about = computed(() => this.profile()?.About?.trim() || '');
  protected readonly technicalContribution = computed(() => this.profile()?.technical_contribution ?? null);
  protected readonly badges = computed(() => this.profile()?.badges ?? []);
  protected readonly certifications = computed(() => this.profile()?.certification_activities ?? []);
  protected readonly trainings = computed(() => this.profile()?.training_activities ?? []);

  protected readonly hasContributions = computed(() => (this.technicalContribution()?.projects?.length ?? 0) > 0);
  protected readonly hasBadges = computed(() => this.badges().length > 0);
  protected readonly hasCertifications = computed(() => this.certifications().length > 0);
  protected readonly hasTrainings = computed(() => this.trainings().length > 0);

  public constructor() {
    // Load the Osano CMP in the browser so the footer's cookie-preferences link works on this public page.
    afterNextRender(() => this.osanoService.load());
  }

  // Opens the Osano cookie-preferences drawer (LFX's cookie manager).
  protected manageCookies(): void {
    this.osanoService.showPreferences();
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
                // 400/404 is the expected "no such profile" path (kept quiet); anything else is
                // an unexpected failure, so log before falling back to the error state.
                console.error('Failed to load public profile', err);
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
