// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, PLATFORM_ID, Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { SelectButtonComponent } from '@components/select-button/select-button.component';
import { ToggleComponent } from '@components/toggle/toggle.component';
import {
  PROFILE_VISIBILITY_DEFAULTS,
  PROFILE_VISIBILITY_KEYS,
  PROFILE_VISIBILITY_MODE_OPTIONS,
  PROFILE_VISIBILITY_PUBLIC_DEFAULT_KEYS,
  PROFILE_VISIBILITY_SECTIONS,
} from '@lfx-one/shared/constants';
import { ProfileVisibility, ProfileVisibilitySaveState, ProfileVisibilitySections, ProfileVisibilityUpdateRequest } from '@lfx-one/shared/interfaces';
import { UserService } from '@services/user.service';
import { MessageService } from 'primeng/api';
import { DrawerModule } from 'primeng/drawer';
import { catchError, debounceTime, EMPTY, filter, finalize, merge, of, Subject, switchMap } from 'rxjs';

import { ProfileVisibilityDrawerService } from './profile-visibility-drawer.service';

/**
 * Right-side public-profile visibility drawer (LFXV2-2629): reads/writes the master `IsPublic` flag
 * plus the section `visibility` preference via `/api/profile/visibility`. Cascade is client-side.
 */
@Component({
  selector: 'lfx-profile-visibility-drawer',
  imports: [DrawerModule, ReactiveFormsModule, ToggleComponent, SelectButtonComponent],
  templateUrl: './profile-visibility-drawer.component.html',
  styleUrl: './profile-visibility-drawer.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfileVisibilityDrawerComponent {
  // Private injections
  private readonly fb = inject(FormBuilder);
  private readonly userService = inject(UserService);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);
  protected readonly drawer = inject(ProfileVisibilityDrawerService);

  // Section toggles shown in the drawer: the standalone activity sections only. The `basic` group
  // (general info / about / personal) is not user-toggleable per the redesign — its keys are still
  // persisted and driven by the master flag cascade (a public profile always exposes them).
  protected readonly activitySections = PROFILE_VISIBILITY_SECTIONS.filter((section) => section.key !== 'basic' && !section.parent);

  // Segmented Private/Public options for the master-flag control (mutable copy for the p-selectbutton input).
  protected readonly modeOptions = [...PROFILE_VISIBILITY_MODE_OPTIONS];

  // One boolean control per visibility key, plus the master `isPublic` flag.
  public readonly visibilityForm: FormGroup = this.buildForm();

  // Form/loading state
  public readonly loadingVisibility = signal<boolean>(true);

  // Auto-save status for the inline indicator (there is no explicit Save button — changes persist on
  // change, debounced, and are flushed when the drawer closes).
  public readonly saveState = signal<ProfileVisibilitySaveState>('idle');

  // Debounce window before an auto-save fires; coalesces rapid toggles (and the master cascade burst).
  private readonly autosaveDebounceMs = 600;

  // True when the form has unpersisted changes. Gates auto-save and the close-time flush.
  private dirty = false;

  // Emits to force an immediate save (bypassing the debounce) when the drawer is dismissed.
  private readonly flush$ = new Subject<void>();

  // The public-profile URL for the copy/open row. Empty on the server or when the username is
  // unknown, which hides the row.
  public readonly publicProfileUrl: Signal<string> = this.initPublicProfileUrl();

  // Mirrors the master `isPublic` form control as a signal so the template can react (section
  // toggles are only meaningful for a public profile). Updated from seedForm and the cascade.
  public readonly isPublic = signal<boolean>(false);

  // True when the public-profile link section should render (profile public + username known). Drives
  // the connected top/bottom corner + seam styling on the visibility card.
  public readonly showPublicUrl: Signal<boolean> = computed(() => this.isPublic() && Boolean(this.publicProfileUrl()));

  public constructor() {
    // Fires once per drawer open (context is the username, or '' when unknown — both non-null).
    const open$ = toObservable(this.drawer.context).pipe(filter((context): context is string => context !== null));

    // Load the current visibility on each open. switchMap cancels a prior open's in-flight request so
    // a slow earlier response can't overwrite a later one; the reset clears stale state on failure.
    open$
      .pipe(
        switchMap(() => {
          this.loadingVisibility.set(true);
          this.saveState.set('idle');
          return this.userService.getProfileVisibility().pipe(
            catchError(() => {
              this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Failed to load visibility settings.' });
              return of(null);
            }),
            finalize(() => this.loadingVisibility.set(false))
          );
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((visibility) => this.seedForm(visibility));

    this.wireCascade();
    this.wireAutoSave();
  }

  public onVisibleChange(visible: boolean): void {
    if (!visible) {
      // Flush any pending (debounced) change before closing so nothing is lost.
      this.flush$.next();
      this.drawer.close();
    }
  }

  public async onCopyUrl(): Promise<void> {
    const url = this.publicProfileUrl();
    if (!url || !isPlatformBrowser(this.platformId)) {
      return;
    }

    try {
      await navigator.clipboard.writeText(url);
      this.messageService.add({ severity: 'success', summary: 'Copied', detail: 'Public profile link copied to clipboard.' });
    } catch {
      this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Failed to copy the link.' });
    }
  }

  // Private helpers

  /** Build the reactive form: one boolean control per visibility key plus the master `isPublic`. */
  private buildForm(): FormGroup {
    const controls = PROFILE_VISIBILITY_KEYS.reduce(
      (acc, key) => {
        acc[key] = this.fb.control<boolean>(PROFILE_VISIBILITY_DEFAULTS[key]);
        return acc;
      },
      { isPublic: this.fb.control<boolean>(false) } as Record<string, unknown>
    );
    return this.fb.group(controls);
  }

  /** Resolve the current form into the update payload the BFF persists (raw includes disabled keys). */
  private buildPayload(): ProfileVisibilityUpdateRequest {
    const raw = this.visibilityForm.getRawValue();
    const sections = PROFILE_VISIBILITY_KEYS.reduce((acc, key) => {
      acc[key] = Boolean(raw[key]);
      return acc;
    }, {} as ProfileVisibilitySections);
    return { isPublic: Boolean(raw.isPublic), sections };
  }

  /**
   * Seed the form from the fetched (or saved) visibility, or all-private defaults on load failure.
   * Clears the dirty flag (emitEvent:false, so it never re-triggers a save) and aligns enabled state.
   */
  private seedForm(visibility: ProfileVisibility | null): void {
    const isPublic = visibility?.isPublic ?? false;
    const sections = visibility?.sections ?? PROFILE_VISIBILITY_DEFAULTS;

    const patch: Record<string, boolean> = { isPublic };
    for (const key of PROFILE_VISIBILITY_KEYS) {
      patch[key] = Boolean(sections[key]);
    }

    // emitEvent: false — the cascade subscriptions are already wired; a plain patch would fight the
    // just-seeded values.
    this.visibilityForm.patchValue(patch, { emitEvent: false });
    this.setSectionsEnabled(isPublic);
    this.isPublic.set(isPublic);
    this.dirty = false;
  }

  /**
   * Debounced auto-save: any user change marks the form dirty; a debounced tick (or the close-time
   * flush) persists the resolved map. switchMap cancels an in-flight save when a newer change lands.
   */
  private wireAutoSave(): void {
    this.visibilityForm.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.dirty = true;
    });

    merge(this.visibilityForm.valueChanges.pipe(debounceTime(this.autosaveDebounceMs)), this.flush$)
      .pipe(
        filter(() => this.dirty && !this.loadingVisibility()),
        switchMap(() => {
          this.dirty = false;
          this.saveState.set('saving');
          return this.userService.updateProfileVisibility(this.buildPayload()).pipe(
            catchError(() => {
              // Re-arm dirty so the next change (or a close flush) retries the failed save.
              this.dirty = true;
              this.saveState.set('error');
              this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Failed to save visibility settings. Please try again.' });
              return EMPTY;
            })
          );
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((visibility) => {
        // Re-seed from the persisted response (syncs preferenceId) without re-triggering a save.
        this.seedForm(visibility);
        this.saveState.set('saved');
      });
  }

  /**
   * Master-flag cascade: turning the profile public enables every section control and forces the
   * basic group (general info / about / personal) on; turning it private zeroes and disables all of
   * them. The basic group has no UI toggle — it is driven entirely from here and re-enforced
   * server-side in `enforcePublicDefaults`. emitEvent:false writes avoid feedback loops (and extra
   * saves).
   */
  private wireCascade(): void {
    const control = (key: string) => this.visibilityForm.get(key);

    control('isPublic')
      ?.valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((isPublic: boolean) => {
        this.isPublic.set(isPublic);
        if (isPublic) {
          this.setSectionsEnabled(true);
          for (const key of PROFILE_VISIBILITY_PUBLIC_DEFAULT_KEYS) {
            control(key)?.setValue(true, { emitEvent: false });
          }
        } else {
          for (const key of PROFILE_VISIBILITY_KEYS) {
            control(key)?.setValue(false, { emitEvent: false });
          }
          this.setSectionsEnabled(false);
        }
      });
  }

  /** Enable or disable every section control (the master flag gates them), without emitting events. */
  private setSectionsEnabled(enabled: boolean): void {
    for (const key of PROFILE_VISIBILITY_KEYS) {
      const control = this.visibilityForm.get(key);
      if (!control) {
        continue;
      }
      if (enabled) {
        control.enable({ emitEvent: false });
      } else {
        control.disable({ emitEvent: false });
      }
    }
  }

  // Private initializer functions

  /**
   * Derive the public-profile URL from the drawer's username context. Empty on the server or when the
   * username is unknown, which hides the copy/open row (and gates {@link showPublicUrl}).
   */
  private initPublicProfileUrl(): Signal<string> {
    return computed(() => {
      const username = this.drawer.context();
      if (!username || !isPlatformBrowser(this.platformId)) {
        return '';
      }
      return `${window.location.origin}/u/${encodeURIComponent(username)}`;
    });
  }
}
