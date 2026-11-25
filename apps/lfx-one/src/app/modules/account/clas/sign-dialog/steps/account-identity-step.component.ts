// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, inject } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { SIGN_IDENTITY_PLATFORM_LABELS } from '@lfx-one/shared/constants';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiChoiceboxGroupComponent } from '@shared/uikit/choicebox/choicebox-group.component';
import { UiChoiceboxComponent } from '@shared/uikit/choicebox/choicebox.component';
import { UiNoteComponent } from '@shared/uikit/note/note.component';

import { SignIdentitySelectComponent } from '../../../../profile/clas/sign-identity-select.component';
import { AccountSignDialogContext } from '../account-sign-dialog-context';

/**
 * The identity step of the Account & Settings "Sign a CLA" dialog (#6077): "Sign {name} as" one of the GitHub accounts or the LF
 * identity the CLA group accepts. It keeps the hub step's already-signed rules and its link to Identities by extending it.
 */
@Component({
  selector: 'lfx-account-identity-step',
  imports: [ReactiveFormsModule, UiButtonComponent, UiChoiceboxGroupComponent, UiChoiceboxComponent, UiNoteComponent],
  templateUrl: './account-identity-step.component.html',
  host: { class: 'flex flex-col gap-[16px]' },
})
export class AccountIdentityStepComponent extends SignIdentitySelectComponent {
  protected readonly pickedName = inject(AccountSignDialogContext).pickedName;
  protected readonly githubHint = `For repositories on ${SIGN_IDENTITY_PLATFORM_LABELS.github}`;
  protected readonly gerritHint = `For ${SIGN_IDENTITY_PLATFORM_LABELS.gerrit} repositories`;
}
