// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, input, model, Signal, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@components/button/button.component';
import { LINKEDIN_LEAD_GEN_CALL_TO_ACTION_OPTIONS } from '@lfx-one/shared/constants';
import type { LinkedInLeadFormsState, LinkedInObjectiveDraft } from '@lfx-one/shared/interfaces';
import {
  linkedInLeadFormOptions,
  linkedInLeadFormOwnerRefusal,
  linkedInLeadFormsFailure,
  linkedInLeadFormsMessage,
  linkedInLeadGenCallToActionChoice,
  linkedInObjectiveDraftWithLeadGenForm,
} from '@lfx-one/shared/utils';
import { CampaignService } from '@services/campaign.service';
import { UiOptionComponent } from '@shared/uikit/select/option.component';
import { UiSelectComponent } from '@shared/uikit/select/select.component';
import { catchError, map, of, startWith, switchMap } from 'rxjs';

/**
 * The Lead Gen Form and its button on a LinkedIn lead generation create (linuxfoundation/lfx-v2-campaign-service#664),
 * sent as `linkedInConfig.leadGenForm` and `leadGenCallToAction`. Lists the forms on the ad account the create uses
 * (`accountId`), DRAFT ones marked; LFX never builds forms. The button defaults to Register. The parent owns the draft,
 * sends it, and holds Create while `linkedInLeadGenCreateRefusal` refuses it. The forms are read while `available`,
 * again whenever the project or account changes, and on "Try again". The rules live in
 * `campaign-linkedin-lead-gen-form.utils.ts`.
 */
@Component({
  selector: 'lfx-linkedin-lead-form-picker',
  imports: [ButtonComponent, UiOptionComponent, UiSelectComponent],
  templateUrl: './linkedin-lead-form-picker.component.html',
})
export class LinkedInLeadFormPickerComponent {
  private readonly campaignService = inject(CampaignService);

  public readonly projectSlug = input.required<string>();
  /** The ad account the create names (`linkedInAudienceAccountId`), or `null` for the default. */
  public readonly accountId = input<string | null>(null);
  /** Who the form is picked for (`linkedInSegmentsOwnerKey`): the foundation and ad account the create uses. */
  public readonly owner = input<string>('');
  /** `linkedInLeadGenEnabled` is an explicit yes. Off, nothing is read and the held choice stays on screen. */
  public readonly available = input<boolean>(false);
  public readonly draft = model.required<LinkedInObjectiveDraft>();

  protected readonly callToActionOptions = LINKEDIN_LEAD_GEN_CALL_TO_ACTION_OPTIONS;

  /** Bumped by "Try again", so a failed read runs again. */
  private readonly attempt = signal(0);
  protected readonly formsState: Signal<LinkedInLeadFormsState> = this.initForms();

  protected readonly formOptions = computed(() => linkedInLeadFormOptions(this.formsState(), this.draft().leadGenForm));
  protected readonly message = computed(() => linkedInLeadFormsMessage(this.formsState()));
  protected readonly callToAction = computed(() => linkedInLeadGenCallToActionChoice(this.draft().leadGenCallToAction));
  /** Why the picked form cannot go with this create: it was picked for another owner (the tab holds Create on it). */
  protected readonly ownerRefusal = computed(() => linkedInLeadFormOwnerRefusal(this.draft(), this.owner()));

  protected onFormChange(id: string | null): void {
    this.draft.update((draft) => linkedInObjectiveDraftWithLeadGenForm(draft, id ?? '', this.owner()));
  }

  protected onCallToActionChange(value: string | null): void {
    this.draft.update((draft) => ({ ...draft, leadGenCallToAction: linkedInLeadGenCallToActionChoice(value) }));
  }

  protected retry(): void {
    this.attempt.update((attempt) => attempt + 1);
  }

  /**
   * The form read while offered. Not cached: it runs again whenever the project or account changes, when the capability
   * returns, and on "Try again". A 403 is the caller's role, not a fault, so only other failures are logged, by status.
   */
  private initForms(): Signal<LinkedInLeadFormsState> {
    const loading: LinkedInLeadFormsState = { status: 'loading', forms: [], failure: null };
    const trigger = computed(() => ({ projectSlug: this.projectSlug(), accountId: this.accountId(), wanted: this.available(), attempt: this.attempt() }), {
      equal: (a, b) => a.projectSlug === b.projectSlug && a.accountId === b.accountId && a.wanted === b.wanted && a.attempt === b.attempt,
    });
    return toSignal(
      toObservable(trigger).pipe(
        switchMap(({ projectSlug, accountId, wanted }) => {
          if (!wanted || projectSlug === '') return of(loading);
          return this.campaignService.getLinkedInLeadForms(projectSlug, accountId ?? undefined).pipe(
            map((result): LinkedInLeadFormsState => ({ status: 'loaded', forms: result.forms, failure: null })),
            catchError((err: unknown) => {
              const status = err instanceof HttpErrorResponse ? err.status : 0;
              if (status !== 403) console.error('LinkedIn lead form read failed:', status);
              return of(linkedInLeadFormsFailure(status, err instanceof HttpErrorResponse ? err.error?.code : undefined));
            }),
            startWith(loading)
          );
        })
      ),
      { initialValue: loading }
    );
  }
}
