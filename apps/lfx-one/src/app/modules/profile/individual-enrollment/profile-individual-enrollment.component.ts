// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { DatePipe, formatDate } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, Signal, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DisplayEnrollment, EnrollmentsState } from '@lfx-one/shared/interfaces';
import { deriveEnrollmentStatus, enrollmentStatusSeverity } from '@lfx-one/shared/utils';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ToastModule } from 'primeng/toast';
import { finalize, take } from 'rxjs';

import { environment } from '@environments/environment';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { EmptyStateComponent } from '@components/empty-state/empty-state.component';
import { TagComponent } from '@components/tag/tag.component';
import { EnrollmentService } from '@services/enrollment.service';

@Component({
  selector: 'lfx-profile-individual-enrollment',
  imports: [ButtonComponent, CardComponent, ConfirmDialogModule, DatePipe, EmptyStateComponent, TagComponent, ToastModule],
  templateUrl: './profile-individual-enrollment.component.html',
  styleUrl: './profile-individual-enrollment.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [ConfirmationService, MessageService],
})
export class ProfileIndividualEnrollmentComponent {
  private readonly enrollmentService = inject(EnrollmentService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly messageService = inject(MessageService);

  protected readonly enrollments = signal<DisplayEnrollment[] | null | undefined>(undefined);
  protected readonly enrollmentError = signal<string | null>(null);
  protected readonly pendingIds = signal<Set<string>>(new Set());

  /** Local overrides for auto-renew values applied optimistically before PATCH completes. */
  private readonly autoRenewOverrides = signal<Map<string, boolean>>(new Map());

  protected readonly displayedEnrollments: Signal<DisplayEnrollment[] | null | undefined> = this.initDisplayedEnrollments();

  public constructor() {
    this.enrollmentService
      .getEnrollments()
      .pipe(takeUntilDestroyed())
      .subscribe((state: EnrollmentsState) => {
        if (state.kind === 'loading') {
          this.enrollments.set(undefined);
          this.enrollmentError.set(null);
        } else if (state.kind === 'error') {
          this.enrollments.set(null);
          this.enrollmentError.set(state.message);
        } else {
          const base = environment.urls.enrollment;
          this.enrollments.set(
            state.items.map((item): DisplayEnrollment => {
              const displayStatus = deriveEnrollmentStatus(item);
              return {
                ...item,
                displayStatus,
                severity: enrollmentStatusSeverity(displayStatus),
                enrollHref: `${base}${item.ctaPath}`,
                renewHref: `${base}${item.ctaPath}&renew=true`,
                pending: false,
              };
            })
          );
          this.enrollmentError.set(null);
        }
      });
  }

  protected isPending(item: DisplayEnrollment): boolean {
    return item.membership ? this.pendingIds().has(item.membership.ID) : false;
  }

  protected onToggleAutoRenew(item: DisplayEnrollment, newValue: boolean): void {
    if (!item.membership || this.isPending(item)) return;

    const membershipId = item.membership.ID;

    const endDate = item.membership.EndDate ? formatDate(item.membership.EndDate, 'mediumDate', 'en-US', 'UTC') : '';
    const message = newValue
      ? `This will enable auto-renew for your membership; your next payment will be charged on ${endDate}.`
      : `This will disable auto-renew for your membership; your current membership will expire on ${endDate}.`;

    this.confirmationService.confirm({
      header: newValue ? 'Enable auto-renew' : 'Disable auto-renew',
      message,
      acceptLabel: newValue ? 'Enable auto-renew' : 'Disable auto-renew',
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: 'p-button-primary p-button-sm',
      rejectButtonStyleClass: 'p-button-text p-button-sm',
      // Apply the change only once the user confirms — nothing happens on reject.
      accept: () => void this.performAutoRenewUpdate(membershipId, newValue),
    });
  }

  private performAutoRenewUpdate(membershipId: string, newValue: boolean): void {
    this.pendingIds.update((s) => new Set([...s, membershipId]));

    // Optimistically reflect the confirmed value while the PATCH is in flight.
    this.autoRenewOverrides.update((m) => {
      const next = new Map(m);
      next.set(membershipId, newValue);
      return next;
    });

    this.enrollmentService
      .updateAutoRenew(membershipId, newValue)
      .pipe(
        take(1),
        finalize(() =>
          this.pendingIds.update((s) => {
            const next = new Set(s);
            next.delete(membershipId);
            return next;
          })
        )
      )
      .subscribe({
        next: () => {
          this.syncAutoRenewValue(membershipId, newValue);
          this.clearAutoRenewOverride(membershipId);
          this.messageService.add({
            severity: 'success',
            summary: 'Success',
            detail: `Auto renew ${newValue ? 'enabled' : 'disabled'} successfully`,
          });
        },
        error: () => {
          this.messageService.add({
            severity: 'error',
            summary: 'Error',
            detail: 'Failed to update membership, please try again',
          });
          this.clearAutoRenewOverride(membershipId);
        },
      });
  }

  private syncAutoRenewValue(membershipId: string, autoRenew: boolean): void {
    this.enrollments.update((list) => {
      if (!list) return list;
      return list.map((item) => {
        if (item.membership?.ID === membershipId) {
          const updatedMembership = { ...item.membership, AutoRenew: autoRenew };
          const updatedItem = { ...item, membership: updatedMembership };
          const displayStatus = deriveEnrollmentStatus(updatedItem);
          return { ...updatedItem, displayStatus, severity: enrollmentStatusSeverity(displayStatus) };
        }
        return item;
      });
    });
  }

  private clearAutoRenewOverride(membershipId: string): void {
    this.autoRenewOverrides.update((m) => {
      const next = new Map(m);
      next.delete(membershipId);
      return next;
    });
  }

  private initDisplayedEnrollments(): Signal<DisplayEnrollment[] | null | undefined> {
    return computed(() => {
      const list = this.enrollments();
      const overrides = this.autoRenewOverrides();
      const pending = this.pendingIds();
      if (!list) return list;
      return list.map((item) => {
        const membershipId = item.membership?.ID;
        const isPending = membershipId ? pending.has(membershipId) : false;
        if (membershipId && overrides.has(membershipId)) {
          const autoRenew = overrides.get(membershipId)!;
          const updatedMembership = { ...item.membership!, AutoRenew: autoRenew };
          const displayStatus = deriveEnrollmentStatus({ ...item, membership: updatedMembership });
          return { ...item, membership: updatedMembership, displayStatus, severity: enrollmentStatusSeverity(displayStatus), pending: isPending };
        }
        return { ...item, pending: isPending };
      });
    });
  }
}
