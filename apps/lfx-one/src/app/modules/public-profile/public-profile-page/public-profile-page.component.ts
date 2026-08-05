// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterNextRender, Component, computed, inject, Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Meta, Title } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { PublicProfile } from '@lfx-one/shared/interfaces';
import { formatAffiliation } from '@lfx-one/shared/utils';
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
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);

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
  // `Image` is omitempty upstream and the template only renders badges that have one, so gate the
  // whole section on at least one renderable badge — otherwise a badge with only a `Url` (or none)
  // would leave the heading above an empty grid.
  protected readonly hasBadges = computed(() => this.badges().some((badge) => !!badge.Image));
  protected readonly hasCertifications = computed(() => this.certifications().length > 0);
  protected readonly hasTrainings = computed(() => this.trainings().length > 0);

  public constructor() {
    // Load the Osano CMP in the browser so the footer's cookie-preferences link works on this public page.
    afterNextRender(() => this.osanoService.load());

    // SEO sync — re-applies head tags whenever `profile()` resolves so crawlers and link
    // unfurlers get the contributor's name/bio/avatar (set during SSR since the profile is
    // fetched server-side). We use `toObservable` + `takeUntilDestroyed` rather than `effect()`
    // because the frontend convention checklist reserves `effect()` for logging/debugging
    // (`docs/reviews/frontend-checklist.md` §5); the constructor's injection context lets
    // `takeUntilDestroyed()` auto-bind the component's `DestroyRef`.
    toObservable(this.profile)
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.applyMetadata());
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

  // Sets the document title and Open Graph / Twitter card tags from the resolved profile.
  // Skips while the profile is null (initial load, error, or the private→not-found redirect)
  // so a stale card never lingers on the next navigation.
  private applyMetadata(): void {
    const basic = this.profile()?.basic;
    if (!basic) {
      return;
    }

    const name = basic.Name?.trim() || 'LFX Contributor';
    // Short bio first, then the "{Title} at {Company}" line, then a generic blurb.
    const description = basic.Bio?.trim() || formatAffiliation(basic) || `${name}'s public contributor profile on LFX.`;
    const image = basic.LogoURL?.trim() || '';

    this.title.setTitle(`${name} · LFX`);
    this.meta.updateTag({ name: 'description', content: description });
    this.meta.updateTag({ property: 'og:title', content: name });
    this.meta.updateTag({ property: 'og:description', content: description });
    this.meta.updateTag({ property: 'og:type', content: 'profile' });
    // `summary` renders a small square thumbnail — the right shape for an avatar.
    this.meta.updateTag({ name: 'twitter:card', content: 'summary' });
    this.meta.updateTag({ name: 'twitter:title', content: name });
    this.meta.updateTag({ name: 'twitter:description', content: description });

    // Avatar is optional upstream; attach it when present, otherwise clear any tag left over
    // from a previous profile so we never advertise the wrong person's image.
    if (image) {
      this.meta.updateTag({ property: 'og:image', content: image });
      this.meta.updateTag({ name: 'twitter:image', content: image });
    } else {
      this.meta.removeTag('property="og:image"');
      this.meta.removeTag('name="twitter:image"');
    }
  }
}
