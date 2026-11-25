// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, inject, Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ReactiveFormsModule } from '@angular/forms';
import { UiBadgeComponent } from '@shared/uikit/badge/badge.component';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiInputComponent } from '@shared/uikit/input/input.component';
import { UiSpinnerComponent } from '@shared/uikit/spinner/spinner.component';
import { map } from 'rxjs';

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

  /** The search as typed, trimmed, for the no-match line. */
  protected readonly trimmedQuery: Signal<string> = toSignal(this.searchForm.controls.query.valueChanges.pipe(map((value) => (value ?? '').trim())), {
    initialValue: '',
  });

  protected override onContinue(): void {
    const option = this.selected();
    if (option) this.context.pickedName.set(option.primaryName);
    super.onContinue();
  }
}
