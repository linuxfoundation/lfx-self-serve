// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, formatDate } from '@angular/common';
import { Component, computed, DestroyRef, inject, Signal, signal, TemplateRef, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AccountCardComponent } from '@components/account-card/account-card.component';
import {
  AccountEnrollmentAction,
  AccountEnrollmentCard,
  AccountEnrollmentFigure,
  DisplayEnrollment,
  EnrollmentDisplayStatus,
  UiBadgeTone,
} from '@lfx-one/shared/interfaces';
import { UiBadgeComponent } from '@shared/uikit/badge/badge.component';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiEmptyStateComponent } from '@shared/uikit/empty-state/empty-state.component';
import { UiModalComponent } from '@shared/uikit/modal/modal.component';
import { UiModalService } from '@shared/uikit/modal/modal.service';
import { UiSkeletonComponent } from '@shared/uikit/skeleton/skeleton.component';
import { ConfirmationService } from 'primeng/api';
import { take } from 'rxjs';

import { ProfileIndividualEnrollmentComponent } from '../../profile/individual-enrollment/profile-individual-enrollment.component';

/**
 * Account & Settings › Individual Enrollment (#6076, behind the profile redesign flag). It keeps the hub tab's loading and
 * auto-renew update by extending it, shows each enrollment as a card with a status badge, one top-right action and a strip of
 * figures, and confirms an auto-renew change in a uikit dialog. When the hub goes (#6094), that logic moves here.
 */
@Component({
  selector: 'lfx-account-individual-enrollment',
  imports: [DatePipe, AccountCardComponent, UiBadgeComponent, UiButtonComponent, UiEmptyStateComponent, UiModalComponent, UiSkeletonComponent],
  // The hub tab injects PrimeNG's ConfirmationService; nothing here opens it. Toasts go to the app's own, as the account pages do.
  providers: [ConfirmationService],
  templateUrl: './account-individual-enrollment.component.html',
})
export class AccountIndividualEnrollmentComponent extends ProfileIndividualEnrollmentComponent {
  private readonly modal = inject(UiModalService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly autoRenewDialog = viewChild.required<TemplateRef<unknown>>('autoRenewDialog');

  protected readonly statusTone: Record<EnrollmentDisplayStatus, UiBadgeTone> = {
    Active: 'success',
    'Expiring Soon': 'warning',
    Expired: 'danger',
    'Not Enrolled': 'neutral',
  };
  /** The enrollments as cards: subtitle, figures and the one action each shows. */
  protected readonly cards: Signal<AccountEnrollmentCard[]> = this.initCards();
  /** The change the auto-renew dialog asks about. */
  protected readonly pendingAutoRenew = signal<{ enable: boolean; endDate: string }>({ enable: false, endDate: '' });

  // The design's confirmation, in place of the hub's PrimeNG one; the update itself is the hub's.
  protected override onToggleAutoRenew(item: DisplayEnrollment, newValue: boolean): void {
    if (!item.membership || this.isPending(item)) return;
    const membershipId = item.membership.id;
    this.pendingAutoRenew.set({ enable: newValue, endDate: item.membership.endDate });
    this.modal
      .open<boolean>(this.autoRenewDialog(), { role: 'alertdialog', autoFocus: '[data-autofocus] button' })
      .closed.pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe((confirmed) => {
        if (confirmed) this.performAutoRenewUpdate(membershipId, newValue);
      });
  }

  private initCards(): Signal<AccountEnrollmentCard[]> {
    return computed(() => {
      const state = this.displayState();
      return state.kind === 'loaded' ? state.items.map((item) => this.toCard(item)) : [];
    });
  }

  private toCard(item: DisplayEnrollment): AccountEnrollmentCard {
    const membership = item.membership;
    const hasPrice = item.price !== null && item.price !== undefined;
    const price = hasPrice ? `$${item.price}/year` : '';
    let subtitle = item.projectName;
    if (!membership) subtitle = hasPrice ? `${price} · Renews every year` : '';
    return {
      item,
      subtitle,
      figures: this.figuresFor(item, price),
      action: this.actionFor(item),
      enrollLabel: hasPrice ? `Enroll now (${price})` : item.enrollButton || 'Enroll',
    };
  }

  // Auto-renew can only change for a card payment that hasn't expired, so its figure and action follow that.
  private figuresFor(item: DisplayEnrollment, price: string): AccountEnrollmentFigure[] {
    const membership = item.membership;
    if (!membership) return [];
    const date = (value: string) => formatDate(value, 'mediumDate', 'en-US', 'UTC');
    const endLabel: Record<EnrollmentDisplayStatus, string> = { Active: 'Renews', 'Expiring Soon': 'Expires', Expired: 'Expired on', 'Not Enrolled': 'Renews' };
    const figures: AccountEnrollmentFigure[] = [];
    if (price) figures.push({ label: 'Price', icon: 'fa-tag', value: price });
    if (membership.purchaseDate) figures.push({ label: 'Purchased', icon: 'fa-credit-card', value: date(membership.purchaseDate) });
    if (membership.endDate) figures.push({ label: endLabel[item.displayStatus], icon: 'fa-calendar', value: date(membership.endDate) });
    if (membership.extPaymentType === 'stripe' && item.displayStatus !== 'Expired') {
      figures.push({ label: 'Auto-renew', icon: 'fa-arrows-rotate', value: membership.autoRenew ? 'Enabled' : 'Disabled' });
    }
    return figures;
  }

  private actionFor(item: DisplayEnrollment): AccountEnrollmentAction | null {
    if (!item.membership) return null;
    if (item.displayStatus === 'Active') return item.membership.extPaymentType === 'stripe' ? 'auto-renew' : null;
    if (item.displayStatus === 'Expiring Soon') return 'renew';
    if (item.displayStatus === 'Expired') return 'repurchase';
    return null;
  }
}
