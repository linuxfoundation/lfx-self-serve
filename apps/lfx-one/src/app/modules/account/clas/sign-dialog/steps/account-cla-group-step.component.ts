// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, Signal } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { UiBadgeComponent } from '@shared/uikit/badge/badge.component';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiInputComponent } from '@shared/uikit/input/input.component';
import { UiSpinnerComponent } from '@shared/uikit/spinner/spinner.component';

import { ClaGroupSelectComponent } from '../../../../profile/clas/cla-group-select.component';
import { AccountSignDialogContext } from '../account-sign-dialog-context';

/**
 * The first step of the Account & Settings "Sign a CLA" dialog (#6077): search for the project, CLA group or repository. It keeps
 * the hub picker's search, keyboard and already-signed rules by extending it, and records the pick for the steps after it.
 */
@Component({
  selector: 'lfx-account-cla-group-step',
  imports: [ReactiveFormsModule, UiBadgeComponent, UiButtonComponent, UiInputComponent, UiSpinnerComponent],
  templateUrl: './account-cla-group-step.component.html',
  host: { class: 'flex flex-col gap-[16px]' },
})
export class AccountClaGroupStepComponent extends ClaGroupSelectComponent {
  private readonly context = inject(AccountSignDialogContext);

  /** The term a finished search found nothing for, or `null` while the typed term is still being searched. */
  protected readonly noMatchQuery: Signal<string | null> = this.initNoMatchQuery();

  protected override onContinue(): void {
    const option = this.selected();
    if (option) this.context.pickedName.set(option.primaryName);
    super.onContinue();
  }

  private initNoMatchQuery(): Signal<string | null> {
    return computed(() => {
      const query = this.query().trim();
      return !this.loading() && this.searchedQuery() === query ? query : null;
    });
  }
}
