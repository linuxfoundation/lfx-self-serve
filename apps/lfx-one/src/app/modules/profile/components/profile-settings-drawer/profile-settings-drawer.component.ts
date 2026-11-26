// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DialogRef } from '@angular/cdk/dialog';
import { isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, DestroyRef, inject, PLATFORM_ID, Signal, signal, TemplateRef, viewChild } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import {
  PROFILE_SETTINGS_DRAWER_COPY,
  PROFILE_VISIBILITY_DEFAULTS,
  PROFILE_VISIBILITY_KEYS,
  PROFILE_VISIBILITY_PUBLIC_DEFAULT_KEYS,
  PROFILE_VISIBILITY_SECTIONS,
} from '@lfx-one/shared/constants';
import {
  ProfileSettingsRowState,
  ProfileSettingsTab,
  ProfileVisibility,
  ProfileVisibilityKey,
  ProfileVisibilitySections,
  UiTabItem,
} from '@lfx-one/shared/interfaces';
import { UserService } from '@services/user.service';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiDrawerComponent } from '@shared/uikit/drawer/drawer.component';
import { UiDrawerService } from '@shared/uikit/drawer/drawer.service';
import { UiNoteComponent } from '@shared/uikit/note/note.component';
import { UiSkeletonComponent } from '@shared/uikit/skeleton/skeleton.component';
import { UiSwitchOptionComponent } from '@shared/uikit/switch/switch-option.component';
import { UiSwitchComponent } from '@shared/uikit/switch/switch.component';
import { UiTabsComponent } from '@shared/uikit/tabs/tabs.component';
import { UiToggleComponent } from '@shared/uikit/toggle/toggle.component';
import { MessageService } from 'primeng/api';
import { catchError, filter, finalize, of, Subscription, take } from 'rxjs';

import { ProfileVisibilityDrawerService } from '../profile-visibility-drawer/profile-visibility-drawer.service';

/** The sections under General profile information. */
const PERSONAL_CHILD_KEYS: readonly ProfileVisibilityKey[] = PROFILE_VISIBILITY_SECTIONS.filter((row) => row.parent === 'basic').map((row) => row.key);

/**
 * The Profile page's Open Profile settings drawer (#6087), behind the profile redesign flag: the Private / Public switch with the
 * public link, then a switch for every section the hub's drawer has, saved together with "Save changes". It reads and writes the
 * same visibility preference as the hub's drawer, which the old hub keeps.
 */
@Component({
  selector: 'lfx-profile-settings-drawer',
  imports: [
    UiButtonComponent,
    UiDrawerComponent,
    UiNoteComponent,
    UiSkeletonComponent,
    UiSwitchComponent,
    UiSwitchOptionComponent,
    UiTabsComponent,
    UiToggleComponent,
  ],
  templateUrl: './profile-settings-drawer.component.html',
})
export class ProfileSettingsDrawerComponent {
  // Private injections
  private readonly drawer = inject(ProfileVisibilityDrawerService);
  private readonly drawerService = inject(UiDrawerService);
  private readonly userService = inject(UserService);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly platformId = inject(PLATFORM_ID);

  private readonly content = viewChild.required<TemplateRef<unknown>>('content');

  protected readonly copy = PROFILE_SETTINGS_DRAWER_COPY;
  protected readonly tabs: UiTabItem[] = [
    { value: 'blocks', label: PROFILE_SETTINGS_DRAWER_COPY.blocksTab },
    { value: 'personal', label: PROFILE_SETTINGS_DRAWER_COPY.personalTab },
  ];

  // Simple WritableSignals
  protected readonly activeTab = signal<ProfileSettingsTab>('blocks');
  protected readonly loading = signal(true);
  protected readonly loadFailed = signal(false);
  protected readonly saving = signal(false);
  /** What is stored, and the unsaved choices on top of it. */
  private readonly stored = signal<ProfileVisibility | null>(null);
  protected readonly isPublic = signal(false);
  protected readonly sections = signal<ProfileVisibilitySections>({ ...PROFILE_VISIBILITY_DEFAULTS });

  // Complex computed/toSignal signals
  protected readonly impersonating = this.userService.impersonating;
  protected readonly visibility = computed(() => (this.isPublic() ? 'public' : 'private'));
  protected readonly dirty: Signal<boolean> = this.initDirty();
  /** The switches below the card wait for a public profile, and stay read-only while impersonating or saving. */
  protected readonly locked = computed(() => !this.isPublic() || this.impersonating() || this.saving());
  protected readonly canSave = computed(() => this.dirty() && !this.saving() && !this.loading() && !this.loadFailed() && !this.impersonating());
  protected readonly publicProfileUrl: Signal<string> = this.initPublicProfileUrl();
  /** The open tab's switches, each with whether its block shows. */
  protected readonly rows: Signal<ProfileSettingsRowState[]> = this.initRows();

  private drawerRef: DialogRef | null = null;
  private loadSubscription: Subscription | null = null;

  public constructor() {
    toObservable(this.drawer.context)
      .pipe(
        filter((context) => context !== null && !this.drawerRef),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(() => this.openDrawer());
    this.destroyRef.onDestroy(() => this.drawerRef?.close());
  }

  protected onVisibilityChange(value: string | null): void {
    if (this.impersonating() || this.saving() || value === null) return;
    const isPublic = value === 'public';
    if (isPublic === this.isPublic()) return;
    this.isPublic.set(isPublic);
    // As today: going public turns the general information on, and going private hides every section.
    if (isPublic) {
      this.sections.update((sections) => ({ ...sections, ...Object.fromEntries(PROFILE_VISIBILITY_PUBLIC_DEFAULT_KEYS.map((key) => [key, true])) }));
    } else {
      this.sections.set({ ...PROFILE_VISIBILITY_DEFAULTS });
    }
  }

  protected onSectionChange(key: ProfileVisibilityKey, shown: boolean): void {
    if (this.locked()) return;
    this.sections.update((sections) => {
      const next = { ...sections, [key]: shown };
      // As the hub's drawer: General profile information switches its children with it, and stays on while either is on.
      if (key === 'basic') {
        for (const child of PERSONAL_CHILD_KEYS) next[child] = shown;
      } else if (PERSONAL_CHILD_KEYS.includes(key)) {
        next.basic = PERSONAL_CHILD_KEYS.some((child) => next[child]);
      }
      return next;
    });
  }

  protected async onCopyUrl(): Promise<void> {
    const url = this.publicProfileUrl();
    if (!url || !isPlatformBrowser(this.platformId)) return;
    try {
      await navigator.clipboard.writeText(url);
      this.messageService.add({ severity: 'success', summary: 'Copied', detail: this.copy.copied });
    } catch {
      this.messageService.add({ severity: 'error', summary: 'Error', detail: this.copy.copyFailed });
    }
  }

  protected retry(): void {
    this.load();
  }

  /** Closes without saving: the choices are read again the next time it opens. */
  protected cancel(): void {
    this.drawerRef?.close();
  }

  protected save(): void {
    if (!this.canSave()) return;
    const visibilityChanged = this.stored()?.isPublic !== this.isPublic();
    this.saving.set(true);
    this.userService
      .updateProfileVisibility({ isPublic: this.isPublic(), sections: this.sections() })
      .pipe(
        finalize(() => this.saving.set(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: (visibility) => {
          this.seed(visibility);
          let detail: string = this.copy.saved;
          if (visibilityChanged) detail = visibility.isPublic ? this.copy.nowPublic : this.copy.nowPrivate;
          this.messageService.add({ severity: 'success', summary: 'Saved', detail });
          this.drawerRef?.close();
        },
        error: (error: unknown) => {
          const detail = this.isImpersonationReadOnly(error) ? this.copy.impersonationBlocked : this.copy.saveFailed;
          this.messageService.add({ severity: 'error', summary: 'Error', detail });
        },
      });
  }

  // Private initializer functions
  private initDirty(): Signal<boolean> {
    return computed(() => {
      const stored = this.stored();
      if (!stored) return false;
      const sections = this.sections();
      return stored.isPublic !== this.isPublic() || PROFILE_VISIBILITY_KEYS.some((key) => Boolean(stored.sections[key]) !== sections[key]);
    });
  }

  // Blocks: the activity sections; Personal data: General profile information and the sections under it.
  private initRows(): Signal<ProfileSettingsRowState[]> {
    return computed(() => {
      const sections = this.sections();
      const personal = this.activeTab() === 'personal';
      return PROFILE_VISIBILITY_SECTIONS.filter((row) => (row.key === 'basic' || !!row.parent) === personal).map((row) => ({
        key: row.key,
        name: row.name,
        description: row.description,
        child: !!row.parent,
        shown: sections[row.key],
      }));
    });
  }

  // The link from the username the drawer opened for; empty on the server or when the username is unknown, which hides it.
  private initPublicProfileUrl(): Signal<string> {
    return computed(() => {
      const username = this.drawer.context();
      if (!username || !isPlatformBrowser(this.platformId)) return '';
      return `${window.location.origin}/u/${encodeURIComponent(username)}`;
    });
  }

  // Private helper methods
  private openDrawer(): void {
    this.activeTab.set('blocks');
    this.load();
    const ref = this.drawerService.open(this.content(), { describedBy: true, canClose: () => !this.saving() });
    this.drawerRef = ref;
    ref.closed.pipe(take(1), takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.drawerRef = null;
      this.loadSubscription?.unsubscribe();
      this.drawer.close();
    });
  }

  // Reads the stored choices on each open, so a cancelled change never carries over.
  private load(): void {
    this.loadSubscription?.unsubscribe();
    this.loading.set(true);
    this.loadFailed.set(false);
    this.stored.set(null);
    this.loadSubscription = this.userService
      .getProfileVisibility()
      .pipe(
        catchError((error: unknown) => {
          console.warn('[ProfileSettingsDrawer] Failed to load the visibility settings', error);
          return of(null);
        }),
        finalize(() => this.loading.set(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((visibility) => {
        if (visibility) this.seed(visibility);
        else this.loadFailed.set(true);
      });
  }

  private seed(visibility: ProfileVisibility): void {
    const sections = { ...PROFILE_VISIBILITY_DEFAULTS };
    for (const key of PROFILE_VISIBILITY_KEYS) sections[key] = Boolean(visibility.sections?.[key]);
    this.stored.set({ ...visibility, sections });
    this.isPublic.set(visibility.isPublic);
    this.sections.set(sections);
  }

  private isImpersonationReadOnly(error: unknown): boolean {
    const httpError = error as HttpErrorResponse;
    return httpError?.status === 403 && httpError?.error?.code === 'IMPERSONATION_READ_ONLY';
  }
}
