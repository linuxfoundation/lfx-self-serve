// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, DestroyRef, inject, Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { SelectComponent } from '@components/select/select.component';
import {
  CAMPAIGN_ACT_AMBIGUOUS_MESSAGE,
  CAMPAIGN_ADOPT_BRIEFS_EMPTY_MESSAGE,
  CAMPAIGN_ADOPT_BRIEFS_FAILED_MESSAGE,
  CAMPAIGN_ADOPT_BRIEFS_UNAVAILABLE_MESSAGE,
  CAMPAIGN_ADOPT_EXPLAINER,
  CAMPAIGN_ADOPT_VERIFY_ABSENT_MESSAGE,
  CAMPAIGN_ADOPT_VERIFY_FAILED_MESSAGE,
  CAMPAIGN_PLATFORMS,
} from '@lfx-one/shared/constants';
import type { CampaignAdoptBriefOption, CampaignAdoptBriefsState, CampaignAdoptDialogData, CampaignAdoptFailure } from '@lfx-one/shared/interfaces';
import { CampaignService } from '@services/campaign.service';
import { campaignAdoptFailure } from '@shared/utils/campaign-optimize-error.utils';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { catchError, map, of, startWith, switchMap, take } from 'rxjs';

/**
 * Adopt a campaign that already exists on its ad platform into one of the project's approved
 * paid-marketing briefs (lfx-self-serve#3299), opened with `DialogService.open()`. Closes with `true`
 * once the campaign is adopted, or with nothing.
 *
 * Adoption creates nothing on the platform; campaign-service reads the campaign under the project's
 * own connection and records it. Every documented refusal is mapped to an actionable message
 * (`campaignAdoptFailure`). An outcome nobody could confirm is NOT retried: Adopt stays disabled
 * until "Check whether it was adopted" resolves the id, because the row may already exist.
 */
@Component({
  selector: 'lfx-campaign-adopt-dialog',
  imports: [ButtonComponent, ReactiveFormsModule, SelectComponent],
  templateUrl: './campaign-adopt-dialog.component.html',
  styleUrl: './campaign-adopt-dialog.component.scss',
})
export class CampaignAdoptDialogComponent {
  private readonly dialogRef = inject(DynamicDialogRef);
  private readonly dialogConfig = inject(DynamicDialogConfig<CampaignAdoptDialogData>);
  private readonly campaignService = inject(CampaignService);
  private readonly messageService = inject(MessageService);
  private readonly destroyRef = inject(DestroyRef);

  public readonly data = this.dialogConfig.data as CampaignAdoptDialogData;

  public readonly form = new FormGroup({
    briefId: new FormControl<string | null>(null, Validators.required),
  });

  protected readonly submitting = signal(false);
  protected readonly checking = signal(false);
  protected readonly failure = signal<CampaignAdoptFailure | null>(null);
  /** Bumped by the brief list's Retry. */
  private readonly briefsReload = signal(0);

  protected readonly explainer = CAMPAIGN_ADOPT_EXPLAINER;
  protected readonly emptyMessage = CAMPAIGN_ADOPT_BRIEFS_EMPTY_MESSAGE;
  protected readonly platformLabel = CAMPAIGN_PLATFORMS.find((p) => p.id === this.data.platform)?.label ?? this.data.platform;

  protected readonly briefs: Signal<CampaignAdoptBriefsState> = this.initBriefs();
  protected readonly briefOptions: Signal<CampaignAdoptBriefOption[]> = computed(() =>
    this.briefs().briefs.map((b) => ({ value: b.id, label: b.programType ? `${b.eventSlug || b.id} (${b.programType})` : b.eventSlug || b.id }))
  );
  /** Adopt waits for a brief, for no write in flight, and for an unconfirmed outcome to be checked first. */
  protected readonly canSubmit: Signal<boolean> = computed(
    () => this.briefs().status === 'ready' && !this.submitting() && !this.checking() && this.failure()?.state !== 'unconfirmed'
  );

  protected retryBriefs(): void {
    this.briefsReload.update((n) => n + 1);
  }

  protected cancel(): void {
    this.dialogRef.close();
  }

  protected submit(): void {
    this.form.markAllAsTouched();
    const briefId = this.form.controls.briefId.value;
    if (!this.canSubmit() || !briefId) {
      return;
    }
    this.submitting.set(true);
    this.failure.set(null);
    // `take(1)`: a write is never tied to the dialog's lifetime, so closing it cannot abort an adoption in flight.
    this.campaignService
      .adoptCampaign(this.data.projectSlug, { briefId, platform: this.data.platform, platformCampaignId: this.data.platformCampaignId })
      .pipe(take(1))
      .subscribe({
        next: () => {
          this.submitting.set(false);
          this.announceAdopted();
        },
        error: (error: unknown) => {
          this.submitting.set(false);
          this.failure.set(campaignAdoptFailure(error, this.platformLabel));
        },
      });
  }

  /**
   * After an unconfirmed adoption: asks LFX One whether the campaign is now bound, through the same
   * campaign-ref resolve the act dialog uses. One match means it was adopted; none means it was not
   * and Adopt is offered again; several is refused as everywhere else.
   */
  protected verify(): void {
    if (this.checking()) {
      return;
    }
    this.checking.set(true);
    this.campaignService
      .resolvePlatformCampaign(this.data.projectSlug, this.data.platform, this.data.platformCampaignId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (resolution) => {
          this.checking.set(false);
          const count = Array.isArray(resolution?.matches) ? resolution.matches.length : 0;
          if (count === 1) {
            this.announceAdopted();
            return;
          }
          this.failure.set({
            state: 'failed',
            title: count === 0 ? 'Not adopted' : 'Not changed',
            message: count === 0 ? CAMPAIGN_ADOPT_VERIFY_ABSENT_MESSAGE : CAMPAIGN_ACT_AMBIGUOUS_MESSAGE,
            detail: '',
          });
        },
        error: () => {
          this.checking.set(false);
          this.failure.update((f) => (f ? { ...f, detail: CAMPAIGN_ADOPT_VERIFY_FAILED_MESSAGE } : f));
        },
      });
  }

  private announceAdopted(): void {
    this.messageService.add({
      severity: 'success',
      summary: `Adopted ${this.data.campaignName}`,
      detail: 'LFX One now manages this campaign. Nothing was changed on the ad platform.',
      life: 5000,
    });
    this.dialogRef.close(true);
  }

  private initBriefs(): Signal<CampaignAdoptBriefsState> {
    const loading: CampaignAdoptBriefsState = { status: 'loading', briefs: [], message: '' };
    return toSignal(
      toObservable(this.briefsReload).pipe(
        switchMap(() =>
          this.campaignService.listAdoptableBriefs(this.data.projectSlug).pipe(
            map((response): CampaignAdoptBriefsState => ({ status: 'ready', briefs: Array.isArray(response?.briefs) ? response.briefs : [], message: '' })),
            catchError((error: unknown) =>
              of<CampaignAdoptBriefsState>({
                status: 'error',
                briefs: [],
                message:
                  error instanceof HttpErrorResponse && error.status === 404 ? CAMPAIGN_ADOPT_BRIEFS_UNAVAILABLE_MESSAGE : CAMPAIGN_ADOPT_BRIEFS_FAILED_MESSAGE,
              })
            ),
            startWith(loading)
          )
        )
      ),
      { initialValue: loading }
    );
  }
}
