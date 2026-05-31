// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe } from '@angular/common';
import { Component, computed, DestroyRef, inject, Injector, signal, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import type { OrgAddressesResponse, OrgCanonicalRecord } from '@lfx-one/shared/interfaces';
import { MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { SkeletonModule } from 'primeng/skeleton';
import { ToastModule } from 'primeng/toast';
import { TooltipModule } from 'primeng/tooltip';
import { catchError, combineLatest, distinctUntilChanged, filter, forkJoin, of, switchMap, tap } from 'rxjs';

import { DisplayValuePipe } from '@pipes/display-value.pipe';
import { InitialsPipe } from '@pipes/initials.pipe';
import { AccountContextService } from '@services/account-context.service';
import { OrgProfileService } from '@services/org-profile.service';
import { OrgRoleGrantsService } from '@services/org-role-grants.service';

import { OrgProfileEditComponent } from './org-profile-edit.component';

/** Spec 021 — Org Profile read-only view (US1): summary card + address cards, writer-gated edit button (FR-005), org-selector reactive (US3, FR-019). */
@Component({
  selector: 'lfx-org-profile',
  standalone: true,
  imports: [DatePipe, SkeletonModule, ButtonModule, ToastModule, TooltipModule, OrgProfileEditComponent, DisplayValuePipe, InitialsPipe],
  providers: [MessageService],
  templateUrl: './org-profile.component.html',
})
export class OrgProfileComponent {
  private readonly accountContext = inject(AccountContextService);
  private readonly orgProfileService = inject(OrgProfileService);
  private readonly orgRoleGrants = inject(OrgRoleGrantsService);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);

  /** US2 toggle — true when the user has clicked "Edit Profile". Reset on org change (US3) and after save/cancel. */
  protected readonly editMode = signal(false);
  protected readonly record = signal<OrgCanonicalRecord | null>(null);
  protected readonly addresses = signal<OrgAddressesResponse | null>(null);
  protected readonly state: Signal<'loading' | 'loaded' | 'error'>;

  private readonly retryTrigger = signal(0);
  private readonly loadState = signal<'loading' | 'loaded' | 'error'>('loading');

  /** Writer detection (FR-005) — uses the existing role-grants signal seeded at bootstrap. */
  protected readonly canEdit = computed(() => {
    const uid = this.accountContext.selectedAccount()?.uid;
    return !!uid && this.orgRoleGrants.writerSet().has(uid);
  });

  /** Auto-prepend `https://` when the stored value lacks a protocol (FR-003). */
  protected readonly websiteHref = computed(() => this.computeUrlHref(this.record()?.website ?? null));
  protected readonly crunchbaseHref = computed(() => this.computeUrlHref(this.record()?.crunchBaseUrl ?? null));

  public constructor() {
    this.state = this.loadState.asReadonly();
    this.initLoadPipeline();
  }

  protected enterEditMode(): void {
    if (!this.canEdit() || !this.record()) return;
    this.editMode.set(true);
  }

  protected exitEditMode(): void {
    this.editMode.set(false);
  }

  /** Called by the edit component after a successful save (FR-009) — refresh the local record and pop back to read-only. */
  protected onProfileSaved(updated: OrgCanonicalRecord): void {
    this.record.set(updated);
    this.accountContext.updateCanonicalRecord(updated);
    this.editMode.set(false);
    this.messageService.add({
      severity: 'success',
      summary: 'Profile updated',
      detail: 'Your organization profile has been saved.',
      life: 3000,
    });
  }

  protected retry(): void {
    this.retryTrigger.update((v) => v + 1);
  }

  private initLoadPipeline(): void {
    // Spec 024 (uuid-only): the org profile loads strictly by uuid.
    const selectedOrgUid$ = toObservable(
      computed(() => this.accountContext.selectedAccount()?.uid ?? null),
      { injector: this.injector }
    );
    const retryTrigger$ = toObservable(this.retryTrigger, { injector: this.injector });

    combineLatest([
      selectedOrgUid$.pipe(
        filter((uid): uid is string => !!uid),
        distinctUntilChanged()
      ),
      retryTrigger$,
    ])
      .pipe(
        tap(() => {
          this.loadState.set('loading');
          this.record.set(null);
          this.addresses.set(null);
          // Exiting edit mode whenever the underlying org changes preserves the "discard unsaved changes" guarantee (FR-019).
          this.editMode.set(false);
        }),
        switchMap(([uid]) => {
          const record$ = this.orgProfileService.getCanonicalRecord(uid);

          return forkJoin({
            record: record$,
            addresses: record$.pipe(switchMap((record) => this.orgProfileService.getAddresses(record.uid).pipe(catchError(() => of(null))))),
          }).pipe(
            catchError(() => {
              this.loadState.set('error');
              return of(null);
            })
          );
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((result) => {
        if (!result) return;
        this.record.set(result.record);
        this.addresses.set(result.addresses);
        this.loadState.set('loaded');
      });
  }

  private computeUrlHref(raw: string | null): string | null {
    if (!raw) return null;
    const trimmed = raw.trim();
    return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  }
}
