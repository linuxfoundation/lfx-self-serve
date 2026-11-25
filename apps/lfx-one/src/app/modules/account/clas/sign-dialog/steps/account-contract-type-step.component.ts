// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiChoiceboxGroupComponent } from '@shared/uikit/choicebox/choicebox-group.component';
import { UiChoiceboxComponent } from '@shared/uikit/choicebox/choicebox.component';

import { SignContractTypeSelectComponent } from '../../../../profile/clas/sign-contract-type-select.component';

/**
 * The contract-type step of the Account & Settings "Sign a CLA" dialog (#6077), for a Gerrit CLA group: individual or corporate
 * contributor. It keeps the hub step's rule that a type the identity already holds can't be picked, by extending it.
 */
@Component({
  selector: 'lfx-account-contract-type-step',
  imports: [ReactiveFormsModule, UiButtonComponent, UiChoiceboxGroupComponent, UiChoiceboxComponent],
  templateUrl: './account-contract-type-step.component.html',
  host: { class: 'flex flex-col gap-[16px]' },
})
export class AccountContractTypeStepComponent extends SignContractTypeSelectComponent {}
