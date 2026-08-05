// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser, isPlatformServer } from '@angular/common';
import { afterNextRender, Component, computed, inject, makeStateKey, PLATFORM_ID, Signal, TransferState } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Meta, Title } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';
import { PublicProfilePageState } from '@lfx-one/shared/interfaces';
import { formatAffiliation } from '@lfx-one/shared/utils';
import { OsanoService } from '@services/osano.service';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, distinctUntilChanged, filter, map, of, startWith, switchMap, tap } from 'rxjs';

import { PublicProfileBadgesComponent } from '../components/public-profile-badges/public-profile-badges.component';
import { PublicProfileCertificationsComponent } from '../components/public-profile-certifications/public-profile-certifications.component';
import { PublicProfileContributionsComponent } from '../components/public-profile-contributions/public-profile-contributions.component';
import { PublicProfileHeroComponent } from '../components/public-profile-hero/public-profile-hero.component';
import { PublicProfileTopbarComponent } from '../components/public-profile-topbar/public-profile-topbar.component';
import { PublicProfileTrainingsComponent } from '../components/public-profile-trainings/public-profile-trainings.component';
import { PublicProfileNotFoundComponent } from '../public-profile-not-found/public-profile-not-found.component';
import { PublicProfileService } from '../services/public-profile.service';

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
    PublicProfileNotFoundComponent,
  ],
  templateUrl: './public-profile-page.component.html',
})
export class PublicProfilePageComponent {
  private readonly activatedRoute = inject(ActivatedRoute);
  private readonly publicProfileService = inject(PublicProfileService);
  private readonly osanoService = inject(OsanoService);
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);
  private readonly transferState = inject(TransferState);
  private readonly platformId = inject(PLATFORM_ID);

  // Persists the SSR-resolved page state so the client's first paint matches the server DOM on every
  // branch — failed responses aren't in HttpTransferCache, so not-found/error would else mismatch.
  private readonly stateKey = makeStateKey<PublicProfilePageState>('publicProfileState');

  // Single source of truth for the async page state; loading/error/notFound/profile derive from it.
  protected readonly state: Signal<PublicProfilePageState> = this.initProfile();

  protected readonly loading = computed(() => this.state().loading);
  protected readonly error = computed(() => this.state().error);
  protected readonly notFound = computed(() => this.state().notFound);
  protected readonly isPrivate = computed(() => this.state().isPrivate);
  protected readonly profile = computed(() => this.state().profile);

  // Section slices — each section is hidden when its slice is empty.
  protected readonly basic = computed(() => this.profile()?.basic ?? null);
  protected readonly about = computed(() => this.profile()?.About?.trim() || '');
  protected readonly technicalContribution = computed(() => this.profile()?.technical_contribution ?? null);
  protected readonly badges = computed(() => this.profile()?.badges ?? []);
  protected readonly certifications = computed(() => this.profile()?.certification_activities ?? []);
  protected readonly trainings = computed(() => this.profile()?.training_activities ?? []);

  protected readonly hasContributions = computed(() => (this.technicalContribution()?.projects?.length ?? 0) > 0);
  // `Image` is omitempty upstream and the template only renders badges that have one — gate on at
  // least one renderable badge so a `Url`-only badge can't leave the heading above an empty grid.
  protected readonly hasBadges = computed(() => this.badges().some((badge) => !!badge.Image));
  protected readonly hasCertifications = computed(() => this.certifications().length > 0);
  protected readonly hasTrainings = computed(() => this.trainings().length > 0);

  public constructor() {
    // Load the Osano CMP in the browser so the footer's cookie-preferences link works on this public page.
    afterNextRender(() => this.osanoService.load());

    // SEO sync — re-apply head tags when `profile()` resolves; `toObservable` + `takeUntilDestroyed`
    // instead of `effect()` per `docs/reviews/frontend-checklist.md` §5 (effect reserved for logging).
    toObservable(this.profile)
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.applyMetadata());
  }

  // Opens the Osano cookie-preferences drawer (LFX's cookie manager).
  protected manageCookies(): void {
    this.osanoService.showPreferences();
  }

  private initProfile(): Signal<PublicProfilePageState> {
    const initial: PublicProfilePageState = { loading: true, error: false, notFound: false, isPrivate: false, profile: null };
    // Seed the client's first paint from the SSR-serialized state (matches the server's resolved
    // branch, no loading flash). Null on the server and on client navigations with no prior SSR state.
    const transferred = this.transferState.get(this.stateKey, null);
    // Consume the SSR state exactly once so a later re-creation of this component (e.g. a different
    // `/u/:username`) can't paint the previous profile's state under the new URL — clients re-fetch fresh.
    if (isPlatformBrowser(this.platformId) && transferred) {
      this.transferState.remove(this.stateKey);
    }
    return toSignal(
      this.activatedRoute.paramMap.pipe(
        map((params) => params.get('username')),
        filter((username): username is string => !!username),
        distinctUntilChanged(),
        switchMap((username, index) =>
          this.publicProfileService.getPublicProfile(username).pipe(
            map((profile): PublicProfilePageState => {
              // Private profiles respond 200 with only `{ isPublic: false }` — render the private
              // not-found view inline (no route change) so no `/u/...` username is reserved.
              if (!profile?.isPublic) {
                return { loading: false, error: false, notFound: true, isPrivate: true, profile: null };
              }
              return { loading: false, error: false, notFound: false, isPrivate: false, profile };
            }),
            catchError((err) => {
              // 400/404 is the expected "no such profile" path (show not-found inline); anything
              // else is an unexpected failure, so log before surfacing the error state.
              const status = err?.status;
              if (typeof status === 'number' && [400, 404].includes(status)) {
                return of<PublicProfilePageState>({ loading: false, error: false, notFound: true, isPrivate: false, profile: null });
              }
              console.error('Failed to load public profile', err);
              return of<PublicProfilePageState>({ loading: false, error: true, notFound: false, isPrivate: false, profile: null });
            }),
            // During SSR, persist each resolved (non-loading) state so the client can hydrate to the
            // same branch. Angular defers serialization until this tracked HTTP call settles.
            tap((state) => {
              if (isPlatformServer(this.platformId) && !state.loading) {
                this.transferState.set(this.stateKey, state);
              }
            }),
            // Seed the first client emission from the SSR state to avoid a loading flash and a
            // hydration mismatch; every later fetch (and each client-side navigation) re-enters loading.
            startWith(index === 0 && transferred ? transferred : initial)
          )
        )
      ),
      { initialValue: transferred ?? initial }
    );
  }

  // Sets title + Open Graph / Twitter tags from the resolved profile; when none is resolved it
  // restores the default head so a prior contributor's card never lingers after a client navigation.
  private applyMetadata(): void {
    const basic = this.profile()?.basic;
    if (!basic) {
      this.resetMetadata();
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

  // Restores the neutral default head (matching index.html) and drops the profile-specific
  // Open Graph / Twitter tags so no prior contributor's card survives a client navigation.
  private resetMetadata(): void {
    const description = 'Public contributor profiles on LFX.';
    this.title.setTitle('LFX');
    this.meta.updateTag({ name: 'description', content: description });
    this.meta.updateTag({ property: 'og:title', content: 'LFX' });
    this.meta.updateTag({ property: 'og:description', content: description });
    this.meta.updateTag({ name: 'twitter:title', content: 'LFX' });
    this.meta.updateTag({ name: 'twitter:description', content: description });
    this.meta.removeTag('property="og:image"');
    this.meta.removeTag('name="twitter:image"');
    this.meta.removeTag('property="og:type"');
    this.meta.removeTag('name="twitter:card"');
  }
}
