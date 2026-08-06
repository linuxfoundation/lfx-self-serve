// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, PLATFORM_ID, Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { SelectButtonComponent } from '@components/select-button/select-button.component';
import { ToggleComponent } from '@components/toggle/toggle.component';
import {
  PROFILE_VISIBILITY_DEFAULTS,
  PROFILE_VISIBILITY_KEYS,
  PROFILE_VISIBILITY_MODE_OPTIONS,
  PROFILE_VISIBILITY_PUBLIC_DEFAULT_KEYS,
  PROFILE_VISIBILITY_SECTIONS,
} from '@lfx-one/shared/constants';
import { ProfileVisibility, ProfileVisibilitySections, ProfileVisibilityUpdateRequest } from '@lfx-one/shared/interfaces';
import { UserService } from '@services/user.service';
import { MessageService } from 'primeng/api';
import { DrawerModule } from 'primeng/drawer';
import { catchError, filter, finalize, of, switchMap } from 'rxjs';

import { ProfileVisibilityDrawerService } from './profile-visibility-drawer.service';

/**
 * Right-side public-profile visibility drawer (LFXV2-2629): reads/writes the master `IsPublic` flag
 * plus the section `visibility` preference via `/api/profile/visibility`. Cascade is client-side.
 */
@Component({
  selector: 'lfx-profile-visibility-drawer',
  imports: [DrawerModule, ReactiveFormsModule, ToggleComponent, ButtonComponent, SelectButtonComponent],
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

  // Section metadata split for the template: the `basic` group (parent + indented children) renders
  // first, then the standalone activity sections.
  protected readonly basicGroup = PROFILE_VISIBILITY_SECTIONS.filter((section) => section.key === 'basic' || section.parent === 'basic');
  protected readonly activitySections = PROFILE_VISIBILITY_SECTIONS.filter((section) => section.key !== 'basic' && !section.parent);

  // Segmented Private/Public options for the master-flag control (mutable copy for the p-selectbutton input).
  protected readonly modeOptions = [...PROFILE_VISIBILITY_MODE_OPTIONS];

  // Which drawer tab is active. `contact` (Contact & Social links) has no backing store yet and
  // renders disabled ("Coming soon"); only `sections` is interactive.
  public readonly activeTab = signal<'sections' | 'contact'>('sections');

  // One boolean control per visibility key, plus the master `isPublic` flag.
  public readonly visibilityForm: FormGroup = this.buildForm();

  // Form/loading state
  public readonly loadingVisibility = signal<boolean>(true);
  public readonly saving = signal<boolean>(false);
  public readonly hasChanges = signal<boolean>(false);

  // The public-profile URL for the copy/open row. Empty on the server or when the username is
  // unknown, which hides the row.
  public readonly publicProfileUrl: Signal<string> = computed(() => {
    const username = this.drawer.context();
    if (!username || !isPlatformBrowser(this.platformId)) {
      return '';
    }
    return `${window.location.origin}/u/${encodeURIComponent(username)}`;
  });

  // Mirrors the master `isPublic` form control as a signal so the template can react (section
  // toggles are only meaningful for a public profile). Updated from seedForm and the cascade.
  public readonly isPublic = signal<boolean>(false);

  public constructor() {
    // Fires once per drawer open (context is the username, or '' when unknown — both non-null).
    const open$ = toObservable(this.drawer.context).pipe(filter((context): context is string => context !== null));

    // Load the current visibility on each open. switchMap cancels a prior open's in-flight request so
    // a slow earlier response can't overwrite a later one; the reset clears stale state on failure.
    open$
      .pipe(
        switchMap(() => {
          this.loadingVisibility.set(true);
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
  }

  public onVisibleChange(visible: boolean): void {
    // Don't let a dismissal (close icon, backdrop, Esc) close the drawer mid-save.
    if (!visible && !this.saving()) {
      this.drawer.close();
    }
  }

  public onCancel(): void {
    this.drawer.close();
  }

  public onSubmit(): void {
    if (this.saving()) {
      return;
    }

    const raw = this.visibilityForm.getRawValue();
    const sections = PROFILE_VISIBILITY_KEYS.reduce((acc, key) => {
      acc[key] = Boolean(raw[key]);
      return acc;
    }, {} as ProfileVisibilitySections);

    const payload: ProfileVisibilityUpdateRequest = {
      isPublic: Boolean(raw.isPublic),
      sections,
    };

    this.saving.set(true);
    this.userService
      .updateProfileVisibility(payload)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        finalize(() => this.saving.set(false))
      )
      .subscribe({
        next: (visibility) => {
          this.messageService.add({ severity: 'success', summary: 'Success', detail: 'Visibility settings updated successfully!' });
          // Re-seed from the persisted response, resetting the pristine/changed baseline, then close.
          this.seedForm(visibility);
          this.drawer.close();
        },
        error: () => {
          this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Failed to update visibility settings. Please try again.' });
        },
      });
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

  /**
   * Seed the form from the fetched (or saved) visibility, or all-private defaults on load failure.
   * Resets the pristine/changed baseline and aligns section-control enabled state to the flag.
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
    this.visibilityForm.markAsPristine();
    this.hasChanges.set(false);
  }

  /**
   * Client-side cascade: master off zeroes+disables all sections, on enables them + the basic group;
   * `basic`↔children mirror via OR. emitEvent:false writes avoid feedback loops.
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
        this.hasChanges.set(true);
      });

    control('basic')
      ?.valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((value: boolean) => {
        control('aboutMe')?.setValue(value, { emitEvent: false });
        control('personalInfo')?.setValue(value, { emitEvent: false });
        this.hasChanges.set(true);
      });

    for (const childKey of ['aboutMe', 'personalInfo']) {
      control(childKey)
        ?.valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(() => {
          const anyChildOn = Boolean(control('aboutMe')?.value) || Boolean(control('personalInfo')?.value);
          control('basic')?.setValue(anyChildOn, { emitEvent: false });
          this.hasChanges.set(true);
        });
    }

    // Any remaining (standalone) section toggle just marks the form as changed.
    for (const section of this.activitySections) {
      control(section.key)
        ?.valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(() => this.hasChanges.set(true));
    }
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
}
