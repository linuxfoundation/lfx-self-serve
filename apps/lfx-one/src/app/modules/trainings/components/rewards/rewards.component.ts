// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Clipboard } from '@angular/cdk/clipboard';
import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, Signal, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { RewardPromotion, RewardsState, RewardsSummaryResponse } from '@lfx-one/shared/interfaces';
import { EMPTY_REWARD_PROMOTIONS } from '@lfx-one/shared/utils';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { SkeletonModule } from 'primeng/skeleton';
import { catchError, combineLatest, distinctUntilChanged, firstValueFrom, map, merge, Observable, of, startWith, Subject, switchMap, tap } from 'rxjs';

import { ButtonComponent } from '@components/button/button.component';
import { RewardsService } from '@shared/services/rewards.service';
import { UserService } from '@shared/services/user.service';
import { extractErrorMessage } from '@shared/utils/http-error.utils';

import { AvailableIncentivesComponent } from './available-incentives/available-incentives.component';
import { MyCouponsComponent } from './my-coupons/my-coupons.component';

const SUMMARY_LOAD_FALLBACK = 'Rewards are temporarily unavailable. Please try again.';

@Component({
  selector: 'lfx-rewards',
  imports: [AvailableIncentivesComponent, ButtonComponent, ConfirmDialogModule, DatePipe, MyCouponsComponent, SkeletonModule],
  templateUrl: './rewards.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RewardsComponent {
  // ─── Private Injections ────────────────────────────────────────────────────
  private readonly rewardsService = inject(RewardsService);
  private readonly clipboard = inject(Clipboard);
  private readonly messageService = inject(MessageService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly userService = inject(UserService);

  // ─── Imperative reload trigger ─────────────────────────────────────────────
  private readonly reloadTrigger$ = new Subject<void>();
  private readonly lastSummary = signal<RewardsSummaryResponse | null>(null);

  // ─── Writable Signals ──────────────────────────────────────────────────────
  public readonly redeemingUids = signal<Record<string, boolean>>({});
  private readonly pendingConfirmationUids = new Set<string>();

  // ─── Declarative State ─────────────────────────────────────────────────────
  protected readonly rewardsState: Signal<RewardsState> = this.initRewardsState();
  public readonly summary = computed(() => this.rewardsState().data);
  public readonly loading = computed(() => this.rewardsState().loading);
  public readonly error = computed(() => this.rewardsState().error);
  public readonly loaded = computed(() => this.summary() !== null);

  // ─── Computed Signals ──────────────────────────────────────────────────────
  public readonly points = computed(() => this.summary()?.points ?? null);
  public readonly nextRewardPoints = computed(() => this.summary()?.nextRewardPoints ?? null);
  public readonly progressPercentage = computed(() => this.summary()?.progressPercentage ?? null);
  public readonly pointsToNextReward = computed(() => this.summary()?.pointsToNextReward ?? null);
  public readonly programExpiryDate = computed(() => this.summary()?.programExpiryDate ?? null);
  public readonly programStartDate = computed(() => this.summary()?.programStartDate ?? null);
  public readonly profileAvailability = computed(() => this.summary()?.availability.profile ?? 'unavailable');
  public readonly promotionsAvailability = computed(() => this.summary()?.availability.promotions ?? 'unavailable');
  public readonly readOnly = computed(() => this.summary()?.readOnly ?? false);
  public readonly availableIncentives = computed<readonly RewardPromotion[]>(() => this.summary()?.availableIncentives ?? EMPTY_REWARD_PROMOTIONS);
  public readonly coupons = computed<readonly RewardPromotion[]>(() => this.summary()?.coupons ?? EMPTY_REWARD_PROMOTIONS);
  public readonly formattedPoints = computed(() => this.points()?.toLocaleString('en-US') ?? 'Unavailable');
  public readonly formattedNextRewardPoints = computed(() => this.nextRewardPoints()?.toLocaleString('en-US') ?? 'Unavailable');

  // ─── Public Methods ────────────────────────────────────────────────────────
  public onRefresh(): void {
    this.reloadTrigger$.next();
  }

  public onClaimIncentive(promotion: RewardPromotion): void {
    if (!this.canRedeem(promotion) || !this.acquireConfirmationLock(promotion.uid)) return;

    this.confirmationService.confirm({
      header: 'Claim Coupon',
      message: `Are you sure you want to claim the coupon for "${promotion.title}"? Your coupon code will be generated and made available for use at checkout.`,
      acceptLabel: 'Yes, claim coupon',
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: 'p-button-info p-button-sm',
      rejectButtonStyleClass: 'p-button-text p-button-sm',
      accept: () => void this.performRedeem(promotion, 'Coupon claimed', 'Your coupon is ready to use.', 'Unable to claim this coupon right now.'),
      reject: () => this.releaseConfirmationLock(promotion.uid),
    });
  }

  public onRedeemCoupon(promotion: RewardPromotion): void {
    if (!this.canRedeem(promotion) || !this.acquireConfirmationLock(promotion.uid)) return;

    const pointsLine = promotion.redeemPoints > 0 ? ` This will use ${promotion.redeemPoints.toLocaleString('en-US')} of your reward points.` : '';

    this.confirmationService.confirm({
      header: 'Redeem Coupon',
      message: `Are you sure you want to redeem "${promotion.title}"?${pointsLine} Once redeemed, this action cannot be undone.`,
      acceptLabel: 'Yes, redeem coupon',
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: 'p-button-info p-button-sm',
      rejectButtonStyleClass: 'p-button-text p-button-sm',
      accept: () => void this.performRedeem(promotion, 'Coupon redeemed', 'Your coupon is ready to use.', 'Unable to redeem this coupon right now.'),
      reject: () => this.releaseConfirmationLock(promotion.uid),
    });
  }

  public onCopyCoupon(couponCode: string): void {
    if (!couponCode) {
      return;
    }

    if (this.clipboard.copy(couponCode)) {
      this.messageService.add({ severity: 'success', summary: 'Copied', detail: 'Coupon code copied to your clipboard.' });
      return;
    }

    this.messageService.add({ severity: 'warn', summary: 'Copy unavailable', detail: 'Could not copy coupon code. Please copy it manually.' });
  }

  // ─── Private Initializers ──────────────────────────────────────────────────
  private initRewardsState(): Signal<RewardsState> {
    const initialState: RewardsState = { loading: true, error: null, data: null };
    const subjectChanges$ = combineLatest([toObservable(this.userService.viewerUsername), toObservable(this.userService.impersonating)]).pipe(
      map(([username, impersonating]) => [username, impersonating] as const),
      distinctUntilChanged(([previousUsername, previousImpersonating], [username, impersonating]) => {
        return previousUsername === username && previousImpersonating === impersonating;
      }),
      tap(() => {
        this.lastSummary.set(null);
        this.redeemingUids.set({});
        this.pendingConfirmationUids.clear();
      }),
      map(() => undefined)
    );

    return toSignal(
      merge(subjectChanges$, this.reloadTrigger$).pipe(
        switchMap(() =>
          this.rewardsService.getSummary().pipe(
            tap((data) => this.lastSummary.set(data)),
            map((data): RewardsState => ({ loading: false, error: null, data })),
            catchError(
              (err): Observable<RewardsState> =>
                of({
                  loading: false,
                  error: extractErrorMessage(err, SUMMARY_LOAD_FALLBACK),
                  data: null,
                })
            ),
            startWith<RewardsState>({ loading: true, error: null, data: this.lastSummary() })
          )
        )
      ),
      { initialValue: initialState }
    );
  }

  // ─── Private Helpers ───────────────────────────────────────────────────────
  private acquireConfirmationLock(uid: string): boolean {
    if (this.pendingConfirmationUids.has(uid)) return false;
    this.pendingConfirmationUids.add(uid);
    return true;
  }

  private releaseConfirmationLock(uid: string): void {
    this.pendingConfirmationUids.delete(uid);
  }

  private canRedeem(promotion: RewardPromotion): boolean {
    if (!promotion.id || this.readOnly()) return false;
    if (promotion.redeemPoints > 0 && this.points() === null) return false;

    if (!promotion.eligible || promotion.redeemed || promotion.coupon || this.redeemingUids()[promotion.uid]) {
      return false;
    }

    return true;
  }

  private async performRedeem(promotion: RewardPromotion, successSummary: string, successDetail: string, errorFallback: string): Promise<void> {
    this.redeemingUids.update((state) => ({ ...state, [promotion.uid]: true }));

    try {
      await firstValueFrom(this.rewardsService.redeemPromotion(promotion.id));

      this.messageService.add({
        severity: 'success',
        summary: successSummary,
        detail: successDetail,
      });

      this.reloadTrigger$.next();
    } catch (err: unknown) {
      this.messageService.add({
        severity: 'error',
        summary: 'Redemption failed',
        detail: extractErrorMessage(err, errorFallback),
      });
    } finally {
      this.redeemingUids.update((state) => {
        const updated = { ...state };
        delete updated[promotion.uid];
        return updated;
      });
      // Released here (not in the dialog `accept`) so the lock spans the
      // entire confirm-then-redeem flow and a second confirmation dialog
      // cannot stack on top of an in-flight request.
      this.releaseConfirmationLock(promotion.uid);
    }
  }
}
