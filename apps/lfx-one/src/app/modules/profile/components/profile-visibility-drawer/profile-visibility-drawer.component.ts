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
import { catchError, concatMap, debounceTime, filter, finalize, map, merge, of, Subject, switchMap } from 'rxjs';

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

  // Sections tab: the standalone activity sections (everything outside the basic group).
  protected readonly activitySections = PROFILE_VISIBILITY_SECTIONS.filter((section) => section.key !== 'basic' && !section.parent);

  // Personal Data tab: the `basic` parent (General Profile Information) and its children (About Me /
  // Personal Information). Parent↔child cascade lives in wireCascade, matching myprofile.
  protected readonly basicSection = PROFILE_VISIBILITY_SECTIONS.find((section) => section.key === 'basic');
  protected readonly basicChildSections = PROFILE_VISIBILITY_SECTIONS.filter((section) => section.parent === 'basic');

  // Active drawer tab. Sections first, then Personal Data.
  public readonly activeTab = signal<'sections' | 'personal'>('sections');

  // Tab order for roving-focus keyboard nav (matches the rendered tablist order).
  private readonly tabOrder = ['sections', 'personal'] as const;

  // Segmented Private/Public options for the master-flag control (mutable copy for the p-selectbutton input).
  protected readonly modeOptions = [...PROFILE_VISIBILITY_MODE_OPTIONS];

  // One boolean control per visibility key, plus the master `isPublic` flag.
  public readonly visibilityForm: FormGroup = this.buildForm();

  // Form/loading state
  public readonly loadingVisibility = signal<boolean>(true);

  // True when the last load failed; the template shows an error + retry block instead of the form,
  // and auto-save stays gated off so an unseeded form can't overwrite the stored map.
  public readonly loadError = signal<boolean>(false);

  // Emits to re-run the load after a failure (the "Try again" action).
  private readonly retry$ = new Subject<void>();

  // Auto-save status for the inline indicator (there is no explicit Save button — changes persist on
  // change, debounced, and are flushed when the drawer closes).
  public readonly saveState = signal<ProfileVisibilitySaveState>('idle');

  // Debounce window before an auto-save fires; coalesces rapid toggles (and the master cascade burst).
  private readonly autosaveDebounceMs = 600;

  // True when the form has unpersisted changes. Gates auto-save and the close-time flush.
  private dirty = false;

  // Count of saves currently in flight or queued (concatMap serializes them). Only the last one to
  // settle re-seeds the form, so an intermediate response can't revert edits a queued save still holds.
  private pendingSaves = 0;

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

    // Load the current visibility on each open (or on an explicit retry). switchMap cancels a prior
    // in-flight request so a slow earlier response can't overwrite a later one. On failure loadError
    // gates the form off; only a successful (non-null) response seeds the form.
    merge(open$, this.retry$)
      .pipe(
        switchMap(() => {
          this.loadingVisibility.set(true);
          this.loadError.set(false);
          this.saveState.set('idle');
          return this.userService.getProfileVisibility().pipe(
            catchError(() => {
              this.loadError.set(true);
              this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Failed to load visibility settings.' });
              return of(null);
            }),
            finalize(() => this.loadingVisibility.set(false))
          );
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((visibility) => {
        if (visibility) {
          this.seedForm(visibility);
        }
      });

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

  /** Re-run the visibility load after a failure (the "Try again" action). */
  public onRetry(): void {
    this.retry$.next();
  }

  /**
   * Roving-focus keyboard nav for the tablist: arrows/Home/End move between tabs (with wraparound),
   * activating and focusing the target. Other keys fall through untouched.
   */
  public onTabKeydown(event: KeyboardEvent, current: 'sections' | 'personal'): void {
    const order = this.tabOrder;
    const index = order.indexOf(current);
    let nextIndex: number;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        nextIndex = (index + 1) % order.length;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        nextIndex = (index - 1 + order.length) % order.length;
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = order.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const next = order[nextIndex];
    this.activeTab.set(next);
    this.focusTab(next);
  }

  // Private helpers

  /** Move DOM focus to a tab button by id (the drawer is appended to <body>, so query the document). */
  private focusTab(tab: 'sections' | 'personal'): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    document.getElementById(`profile-visibility-drawer-tab-${tab}`)?.focus();
  }

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
   * flush) persists the resolved map. concatMap serializes the writes — switchMap would only cancel
   * the client subscription while the upstream PATCH keeps writing, letting overlapping saves persist
   * out of order.
   */
  private wireAutoSave(): void {
    this.visibilityForm.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.dirty = true;
    });

    merge(this.visibilityForm.valueChanges.pipe(debounceTime(this.autosaveDebounceMs)), this.flush$)
      .pipe(
        filter(() => this.dirty && !this.loadingVisibility() && !this.loadError()),
        // Serialize saves: each PATCH to /me + the preference completes before the next starts, so a
        // slower earlier write can't land after (and overwrite) a newer one.
        concatMap(() => {
          this.dirty = false;
          this.pendingSaves++;
          this.saveState.set('saving');
          return this.userService.updateProfileVisibility(this.buildPayload()).pipe(
            map((visibility) => ({ ok: true, visibility: visibility as ProfileVisibility | null })),
            catchError(() => {
              // Re-arm dirty so the next change (or a close flush) retries the failed save.
              this.dirty = true;
              this.saveState.set('error');
              this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Failed to save visibility settings. Please try again.' });
              return of({ ok: false, visibility: null as ProfileVisibility | null });
            })
          );
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((result) => {
        this.pendingSaves--;
        if (!result.ok) {
          // Error already surfaced and dirty re-armed for retry; leave the indicator on 'error'.
          return;
        }
        // Re-seed from the persisted response only when this is the last settled save (nothing dirty,
        // nothing still queued) — otherwise re-seeding would revert edits a queued save still holds.
        const busy = this.dirty || this.pendingSaves > 0;
        if (!busy) {
          this.seedForm(result.visibility);
        }
        this.saveState.set(busy ? 'saving' : 'saved');
      });
  }

  /**
   * Client-side cascade (matches myprofile): going public enables all sections and defaults the basic
   * group on, going private zeroes all; the basic parent mirrors to its children and ORs back from them.
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

    control('basic')
      ?.valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((value: boolean) => {
        control('aboutMe')?.setValue(value, { emitEvent: false });
        control('personalInfo')?.setValue(value, { emitEvent: false });
      });

    for (const childKey of ['aboutMe', 'personalInfo']) {
      control(childKey)
        ?.valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(() => {
          const anyChildOn = Boolean(control('aboutMe')?.value) || Boolean(control('personalInfo')?.value);
          control('basic')?.setValue(anyChildOn, { emitEvent: false });
        });
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
