// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, input, model, Signal, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { LINKEDIN_MAX_CONVERSIONS } from '@lfx-one/shared/constants';
import type { LinkedInConversionsState, LinkedInObjectiveDraft } from '@lfx-one/shared/interfaces';
import {
  linkedInCanAddConversion,
  linkedInConversionChoices,
  linkedInConversionPicks,
  linkedInConversionsFailure,
  linkedInConversionsMessage,
  linkedInConversionsOwnerRefusal,
  linkedInObjectiveChoice,
  linkedInObjectiveDraftWithConversions,
} from '@lfx-one/shared/utils';
import { CampaignService } from '@services/campaign.service';
import { UiOptionComponent } from '@shared/uikit/select/option.component';
import { UiSelectComponent } from '@shared/uikit/select/select.component';
import { catchError, map, of, startWith, switchMap } from 'rxjs';

/**
 * The LinkedIn objective on the Implement tab (#5764 rows 2 and 4): set by bidding (the default, nothing sent),
 * website visits or website conversions, and with conversions the ad account's conversion rules to track. The parent
 * owns the draft, sends it, and holds Create while `linkedInObjectiveCreateRefusal` refuses it. The rules are read only
 * while conversions is chosen and offered, once per project and account. The rules live in
 * `campaign-linkedin-objective-form.utils.ts`.
 */
@Component({
  selector: 'lfx-linkedin-objective-picker',
  imports: [ButtonComponent, ReactiveFormsModule, UiOptionComponent, UiSelectComponent],
  templateUrl: './linkedin-objective-picker.component.html',
})
export class LinkedInObjectivePickerComponent {
  private readonly campaignService = inject(CampaignService);

  public readonly projectSlug = input.required<string>();
  /** The ad account the create names (`linkedInAudienceAccountId`), or `null` for the default. */
  public readonly accountId = input<string | null>(null);
  /** Who conversion rules are picked for (`linkedInSegmentsOwnerKey`): the foundation and ad account the create uses. */
  public readonly owner = input<string>('');
  /** `linkedInConversionsEnabled` is an explicit yes. Off, a held choice stays on screen so it can be set back. */
  public readonly available = input<boolean>(false);
  public readonly draft = model.required<LinkedInObjectiveDraft>();

  protected readonly maxConversions = LINKEDIN_MAX_CONVERSIONS;
  protected readonly addControl = new FormControl<string | null>(null);

  /** Bumped by "Try again", so a failed read runs again. */
  private readonly attempt = signal(0);
  protected readonly conversionsState: Signal<LinkedInConversionsState> = this.initConversions();

  protected readonly picks = computed(() => linkedInConversionPicks(this.conversionsState(), this.draft().conversions));
  protected readonly choices = computed(() => linkedInConversionChoices(this.conversionsState(), this.draft().conversions));
  protected readonly canAdd = computed(() => linkedInCanAddConversion(this.draft()));
  protected readonly message = computed(() => linkedInConversionsMessage(this.conversionsState(), this.choices().length));
  /** Why the rules picked cannot go with this create: they were picked for another owner (the tab holds Create on it). */
  protected readonly ownerRefusal = computed(() => linkedInConversionsOwnerRefusal(this.draft(), this.owner()));

  protected onObjectiveChange(value: string | null): void {
    this.draft.update((draft) => ({ ...draft, objective: linkedInObjectiveChoice(value) }));
  }

  protected onAdd(id: string | null): void {
    const rule = this.choices().find((choice) => choice.id === id);
    if (rule && this.canAdd()) this.setConversions([...this.draft().conversions, rule.id]);
    this.addControl.setValue(null, { emitEvent: false });
  }

  protected onRemove(id: string): void {
    this.setConversions(this.draft().conversions.filter((picked) => picked !== id));
  }

  protected retry(): void {
    this.attempt.update((attempt) => attempt + 1);
  }

  private setConversions(conversions: string[]): void {
    this.draft.update((draft) => linkedInObjectiveDraftWithConversions(draft, conversions, this.owner()));
  }

  /**
   * The conversion rule read, once per project and account while conversions is chosen and offered (and again on "Try
   * again"). Everything is read INSIDE the trigger, so a switch drops a read that no longer applies. A 403 is the
   * caller's role, not a fault, so only other failures are logged, by status.
   */
  private initConversions(): Signal<LinkedInConversionsState> {
    const loading: LinkedInConversionsState = { status: 'loading', conversions: [], failure: null };
    const trigger = computed(() => ({
      projectSlug: this.projectSlug(),
      accountId: this.accountId(),
      wanted: this.available() && this.draft().objective === 'conversions',
      attempt: this.attempt(),
    }));
    return toSignal(
      toObservable(trigger).pipe(
        switchMap(({ projectSlug, accountId, wanted }) => {
          if (!wanted || projectSlug === '') return of(loading);
          return this.campaignService.getLinkedInConversions(projectSlug, accountId ?? undefined).pipe(
            map((result): LinkedInConversionsState => ({ status: 'loaded', conversions: result.conversions, failure: null })),
            catchError((err: unknown) => {
              const status = err instanceof HttpErrorResponse ? err.status : 0;
              if (status !== 403) console.error('LinkedIn conversion rule read failed:', status);
              return of(linkedInConversionsFailure(status, err instanceof HttpErrorResponse ? err.error?.code : undefined));
            }),
            startWith(loading)
          );
        })
      ),
      { initialValue: loading }
    );
  }
}
