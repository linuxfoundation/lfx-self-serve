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
  CAMPAIGN_ADOPT_PENDING_MESSAGE,
  CAMPAIGN_ADOPT_VERIFY_ABSENT_MESSAGE,
  CAMPAIGN_ADOPT_VERIFY_FAILED_MESSAGE,
  CAMPAIGN_ADOPT_VERIFY_OTHER_BRIEF_MESSAGE,
  CAMPAIGN_ADOPT_VERIFY_UNEXPECTED_MESSAGE,
  CAMPAIGN_PLATFORMS,
} from '@lfx-one/shared/constants';
import type {
  CampaignAdoptBriefOption,
  CampaignAdoptBriefsState,
  CampaignAdoptDialogData,
  CampaignAdoptFailure,
  CampaignAdoptionInFlight,
} from '@lfx-one/shared/interfaces';
import { readCampaignRefResolution } from '@lfx-one/shared/utils';
import { CampaignAdoptionStateService } from '@services/campaign-adoption-state.service';
import { CampaignService } from '@services/campaign.service';
import { campaignAdoptFailure } from '@shared/utils/campaign-optimize-error.utils';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { catchError, filter, map, of, startWith, switchMap, take } from 'rxjs';

/**
 * Adopt a campaign that already exists on its ad platform into one of the project's approved
 * paid-marketing briefs (lfx-self-serve#3299), opened with `DialogService.open()`. Closes with `true`
 * once the campaign is adopted, or with nothing.
 *
 * Adoption creates nothing on the platform; campaign-service reads the campaign under the project's
 * own connection and records it. Every documented refusal is mapped to an actionable message
 * (`campaignAdoptFailure`). An outcome nobody could confirm is NOT retried: Adopt stays disabled
 * until "Check whether it was adopted" resolves the id, because the row may already exist. That lock,
 * and a write still in flight, are kept in `CampaignAdoptionStateService`, so closing and reopening
 * the dialog cannot clear them; a write that answers after the dialog closed reports in a sticky toast.
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
  private readonly adoptionState = inject(CampaignAdoptionStateService);

  public readonly data = this.dialogConfig.data as CampaignAdoptDialogData;

  public readonly form = new FormGroup({
    briefId: new FormControl<string | null>(null, Validators.required),
  });

  protected readonly checking = signal(false);
  /** A DEFINITE outcome shown in this dialog only; an unsettled one lives in the store. */
  private readonly localFailure = signal<CampaignAdoptFailure | null>(null);
  /** Bumped by the brief list's Retry. */
  private readonly briefsReload = signal(0);
  /** Set when the dialog is destroyed: a write answering later reports through a sticky toast instead. */
  private closed = false;

  protected readonly explainer = CAMPAIGN_ADOPT_EXPLAINER;
  protected readonly emptyMessage = CAMPAIGN_ADOPT_BRIEFS_EMPTY_MESSAGE;
  protected readonly pendingMessage = CAMPAIGN_ADOPT_PENDING_MESSAGE;
  protected readonly platformLabel = CAMPAIGN_PLATFORMS.find((p) => p.id === this.data.platform)?.label ?? this.data.platform;

  /** This campaign's unsettled adoption, from the store that outlives every dialog. */
  private readonly key = CampaignAdoptionStateService.key(this.data.projectSlug, this.data.platform, this.data.platformCampaignId);
  private readonly inFlight: Signal<CampaignAdoptionInFlight | null> = this.adoptionState.entry(this.key);
  protected readonly submitting: Signal<boolean> = computed(() => this.inFlight()?.state === 'pending');
  /** An unconfirmed adoption (from this dialog or an earlier one) first, else this dialog's definite outcome. */
  protected readonly failure: Signal<CampaignAdoptFailure | null> = computed(() => {
    const entry = this.inFlight();
    return entry?.state === 'unconfirmed' ? entry.failure : this.localFailure();
  });

  protected readonly briefs: Signal<CampaignAdoptBriefsState> = this.initBriefs();
  protected readonly briefOptions: Signal<CampaignAdoptBriefOption[]> = computed(() =>
    this.briefs().briefs.map((b) => ({ value: b.id, label: b.programType ? `${b.eventSlug || b.id} (${b.programType})` : b.eventSlug || b.id }))
  );
  /** Adopt waits for a brief, for no write in flight, and for an unconfirmed outcome to be checked first. */
  protected readonly canSubmit: Signal<boolean> = computed(() => this.briefs().status === 'ready' && !this.checking() && this.inFlight() === null);

  public constructor() {
    this.destroyRef.onDestroy(() => {
      this.closed = true;
    });
    // Any live dialog for this campaign — the one that sent the write, or one reopened while it was in
    // flight — shows a success as soon as the store records it, and closes. One opened after a success
    // nobody saw closes at once the same way. Never re-offers Adopt.
    toObservable(this.inFlight)
      .pipe(
        filter((entry) => entry?.state === 'adopted'),
        take(1),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(() => {
        this.adoptionState.settle(this.key);
        this.dialogRef.close(true);
      });
  }

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
    const key = this.key;
    this.adoptionState.markPending(key, briefId);
    this.localFailure.set(null);
    // `take(1)`: a write is never tied to the dialog's lifetime, so closing it cannot abort an adoption
    // in flight. Its outcome settles the STORE, which any reopened dialog reads.
    this.campaignService
      .adoptCampaign(this.data.projectSlug, { briefId, platform: this.data.platform, platformCampaignId: this.data.platformCampaignId })
      .pipe(take(1))
      .subscribe({
        next: () => {
          // Recorded, not cleared: a dialog reopened meanwhile must learn of it rather than re-offer Adopt.
          this.adoptionState.markAdopted(key, briefId);
          this.announceAdopted();
        },
        error: (error: unknown) => {
          const failure = campaignAdoptFailure(error, this.platformLabel);
          if (failure.state === 'unconfirmed') {
            this.adoptionState.markUnconfirmed(key, briefId, failure);
          } else {
            this.adoptionState.settle(key);
            this.localFailure.set(failure);
          }
          if (this.closed) {
            this.messageService.add({
              severity: failure.state === 'unconfirmed' ? 'warn' : 'error',
              summary: `${failure.title}: ${this.data.campaignName}`,
              detail: failure.detail ? `${failure.message} ${failure.detail}` : failure.message,
              sticky: true,
            });
          }
        },
      });
  }

  /**
   * After an unconfirmed adoption: asks LFX One whether the campaign is now bound, through the same
   * campaign-ref resolve the act dialog uses. Only a match on the brief the adoption was SENT for
   * confirms it; a match on another brief means this adoption did not happen; none means it did not
   * happen and Adopt is offered again. Several, like a self-contradicting answer, settles nothing:
   * the adoption stays unconfirmed and Adopt stays locked.
   */
  protected verify(): void {
    const entry = this.inFlight();
    if (this.checking() || entry?.state !== 'unconfirmed') {
      return;
    }
    const key = this.key;
    this.checking.set(true);
    this.campaignService
      .resolvePlatformCampaign(this.data.projectSlug, this.data.platform, this.data.platformCampaignId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (resolution) => {
          this.checking.set(false);
          // The act dialog's reading: a self-contradicting answer neither confirms the adoption nor
          // unlocks a second one, so the outcome stays unconfirmed.
          const verdict = readCampaignRefResolution(resolution, this.data.platformCampaignId, this.data.platform);
          if (verdict.kind === 'unexpected') {
            this.adoptionState.annotate(key, CAMPAIGN_ADOPT_VERIFY_UNEXPECTED_MESSAGE);
            return;
          }
          // Several matches say nothing about whether THIS adoption landed, so the lock stays: only
          // no match, or one match (here or on another brief), settles it.
          if (verdict.kind === 'several') {
            this.adoptionState.annotate(key, CAMPAIGN_ACT_AMBIGUOUS_MESSAGE);
            return;
          }
          if (verdict.kind === 'one' && verdict.match.brief_id === entry.briefId) {
            this.adoptionState.markAdopted(key, entry.briefId);
            this.announceAdopted();
            return;
          }
          this.adoptionState.settle(key);
          this.localFailure.set(this.unsettledCheckFailure(verdict.kind));
        },
        error: () => {
          this.checking.set(false);
          this.adoptionState.annotate(key, CAMPAIGN_ADOPT_VERIFY_FAILED_MESSAGE);
        },
      });
  }

  /** What a check that settled the adoption as NOT made says: no match, or a match on another brief. */
  private unsettledCheckFailure(kind: 'none' | 'one'): CampaignAdoptFailure {
    if (kind === 'one') {
      return { state: 'failed', title: 'Not adopted: bound to a different brief', message: CAMPAIGN_ADOPT_VERIFY_OTHER_BRIEF_MESSAGE, detail: '' };
    }
    return { state: 'failed', title: 'Not adopted', message: CAMPAIGN_ADOPT_VERIFY_ABSENT_MESSAGE, detail: '' };
  }

  /** Announces a success; the store's `adopted` entry closes every live dialog for this campaign. */
  private announceAdopted(): void {
    this.messageService.add({
      severity: 'success',
      summary: `Adopted ${this.data.campaignName}`,
      detail: 'LFX One now manages this campaign. Nothing was changed on the ad platform.',
      life: 5000,
    });
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
