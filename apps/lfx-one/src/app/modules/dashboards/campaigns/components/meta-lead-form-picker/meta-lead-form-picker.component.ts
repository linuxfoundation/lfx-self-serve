// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, effect, inject, input, model, output, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { META_LEAD_FORM_PICKER_EMPTY, META_LEAD_FORM_PICKER_LOADING, META_LEAD_FORM_PICKER_REASONS } from '@lfx-one/shared/constants';
import type { MetaLeadFormPickerState, MetaLeadFormPickerView } from '@lfx-one/shared/interfaces';
import { metaHeldLeadFormRefusal, metaLeadFormChoices, metaLeadFormPickerView } from '@lfx-one/shared/utils';
import { CampaignService } from '@services/campaign.service';
import { UiInputComponent } from '@shared/uikit/input/input.component';
import { UiOptionComponent } from '@shared/uikit/select/option.component';
import { UiSelectComponent } from '@shared/uikit/select/select.component';
import { catchError, map, of, startWith, switchMap } from 'rxjs';

/**
 * The Meta Instant Form of a Leads create on the Implement tab (#5940), sent as `metaConfig.leadFormId`. Lists the
 * forms on the Facebook Page the project's Meta connection uses; only an ACTIVE one can be picked. When the list
 * cannot be read, a typed form id from Meta Ads Manager is the way in. LFX never creates forms. The parent shows
 * this only to a caller who may send a form, owns the id, validates it and holds Create.
 */
@Component({
  selector: 'lfx-meta-lead-form-picker',
  imports: [UiInputComponent, UiOptionComponent, UiSelectComponent],
  templateUrl: './meta-lead-form-picker.component.html',
})
export class MetaLeadFormPickerComponent {
  private readonly campaignService = inject(CampaignService);

  public readonly projectSlug = input.required<string>();

  public readonly leadFormId = model.required<string>();

  protected readonly loadingText = META_LEAD_FORM_PICKER_LOADING;
  protected readonly emptyText = META_LEAD_FORM_PICKER_EMPTY;

  protected readonly picker: Signal<MetaLeadFormPickerState> = this.initPicker();
  /** What a read list shows; a held id the list does not show (typed or restored) stays on screen, even on an empty list, so it can be seen and cleared. */
  protected readonly view = computed<MetaLeadFormPickerView>(() => metaLeadFormPickerView(this.picker().choices, this.leadFormId()));
  /** Why the held form cannot be sent once the Page's forms are read (#6107), or `null`: shown here and reported to the tab, which holds Create. */
  protected readonly heldRefusal = computed<string | null>(() => metaHeldLeadFormRefusal(this.picker(), this.leadFormId()));

  /** Emits {@link heldRefusal} on every change (and `null` first), so the tab's Create hold follows the list. */
  public readonly heldRefusalChange = output<string | null>();

  public constructor() {
    effect(() => this.heldRefusalChange.emit(this.heldRefusal()));
  }

  protected onPick(value: string | null): void {
    this.leadFormId.set(value ?? '');
  }

  protected onType(value: string): void {
    this.leadFormId.set(value.trim());
  }

  /** The Page's forms, read whenever the project changes. A 403 or 404 here is the deployment or the gateway, since the parent shows this only to a caller the route admits. */
  private initPicker(): Signal<MetaLeadFormPickerState> {
    const state = (status: MetaLeadFormPickerState['status'], reason: string | null = null): MetaLeadFormPickerState => ({ status, choices: [], reason });
    return toSignal(
      toObservable(this.projectSlug).pipe(
        switchMap((projectSlug) => {
          if (projectSlug === '') return of(state('idle'));
          return this.campaignService.getMetaLeadForms(projectSlug).pipe(
            map((result): MetaLeadFormPickerState => ({ status: 'loaded', choices: metaLeadFormChoices(result.forms), reason: null })),
            catchError((err: unknown) => {
              console.error('Failed to read the Meta lead forms:', err);
              const status = err instanceof HttpErrorResponse ? err.status : 0;
              const reason = status === 403 || status === 404 ? META_LEAD_FORM_PICKER_REASONS.unavailable : META_LEAD_FORM_PICKER_REASONS.failed;
              return of(state('unavailable', reason));
            }),
            startWith(state('loading'))
          );
        })
      ),
      { initialValue: state('idle') }
    );
  }
}
