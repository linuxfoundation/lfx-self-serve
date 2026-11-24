// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, DestroyRef, inject, Injectable, Signal, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CombinedProfile, UserMetadata } from '@lfx-one/shared/interfaces';
import { catchError, finalize, of, Subject, switchMap } from 'rxjs';

import { ProfileSaveSyncService } from './profile-save-sync.service';
import { UserService } from './user.service';

/**
 * The signed-in user's profile for Account & Settings (#6072), provided by the shell so a save replayed after a Flow C return
 * reaches the Personal information page. The profile GET is eventually consistent, so every save is kept and laid over each
 * fetch; otherwise a refetch straight after a save could show the values from before it.
 */
@Injectable()
export class AccountProfileService {
  private readonly userService = inject(UserService);
  private readonly saveSync = inject(ProfileSaveSyncService);

  private readonly load$ = new Subject<void>();
  private readonly fetched = signal<CombinedProfile | null>(null);
  private readonly saved = signal<Partial<UserMetadata>>({});

  public readonly loading = signal(false);
  public readonly failed = signal(false);
  /** The fetched profile with every save made since laid over it; `null` until the first fetch lands. */
  public readonly profile: Signal<CombinedProfile | null> = computed(() => this.withSaves(this.fetched(), this.saved()));

  public constructor() {
    this.load$
      .pipe(
        switchMap(() => {
          this.loading.set(true);
          this.failed.set(false);
          return this.userService.getCurrentUserProfile().pipe(
            catchError(() => {
              this.failed.set(true);
              return of(null);
            }),
            finalize(() => this.loading.set(false))
          );
        }),
        takeUntilDestroyed(inject(DestroyRef))
      )
      .subscribe((profile) => {
        if (profile) this.fetched.set(profile);
      });
  }

  /** Fetches the profile again; a fetch still in flight is dropped. */
  public load(): void {
    this.load$.next();
  }

  /** Records a save so the profile shows it at once, and carries it to the navbar, avatar and Mentorship. */
  public applySaved(metadata: Partial<UserMetadata>): void {
    this.saveSync.apply(metadata, this.profile()?.user);
    // Keys left undefined were not sent, so the stored value stands; a cleared field is '' and is kept.
    const defined = Object.fromEntries(Object.entries(metadata).filter(([, value]) => value !== undefined)) as Partial<UserMetadata>;
    this.saved.update((saved) => ({ ...saved, ...defined }));
  }

  // With no profile record yet, laying saves over it would invent one, so they wait for a fetch that has a record.
  private withSaves(profile: CombinedProfile | null, saved: Partial<UserMetadata>): CombinedProfile | null {
    if (!profile || profile.profile == null || Object.keys(saved).length === 0) return profile;
    return {
      ...profile,
      // first_name and last_name are derived from given_name and family_name server-side.
      user: { ...profile.user, first_name: saved.given_name ?? profile.user.first_name, last_name: saved.family_name ?? profile.user.last_name },
      profile: { ...profile.profile, ...saved },
    };
  }
}
