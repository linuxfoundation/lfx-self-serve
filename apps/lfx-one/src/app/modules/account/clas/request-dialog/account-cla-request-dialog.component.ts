// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DIALOG_DATA } from '@angular/cdk/dialog';
import { Component, computed, inject, Signal } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { environment } from '@environments/environment';
import { ACCOUNT_CLAS_COPY } from '@lfx-one/shared/constants';
import { AccountClaRequestDialogData } from '@lfx-one/shared/interfaces';
import { canManageInCclaConsole, cclaConsoleUrl } from '@lfx-one/shared/utils';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiCheckboxComponent } from '@shared/uikit/checkbox/checkbox.component';
import { UiModalComponent } from '@shared/uikit/modal/modal.component';
import { UiNoteComponent } from '@shared/uikit/note/note.component';
import { UiSkeletonComponent } from '@shared/uikit/skeleton/skeleton.component';
import { UiTextareaComponent } from '@shared/uikit/textarea/textarea.component';

import { ContactClaManagerComponent } from '../../../profile/clas/contact-cla-manager.component';

/**
 * The CCLA request dialog of Account & Settings › CLAs (#6077): ask the company's CLA managers to add you to, or remove you from,
 * a Corporate CLA's approval list, or send them a message. It keeps the hub dialog's manager list, message rules and sending by
 * extending it, with the design's copy and a link to manage the CCLA in its console.
 */
@Component({
  selector: 'lfx-account-cla-request-dialog',
  imports: [ReactiveFormsModule, UiModalComponent, UiButtonComponent, UiCheckboxComponent, UiNoteComponent, UiSkeletonComponent, UiTextareaComponent],
  templateUrl: './account-cla-request-dialog.component.html',
})
export class AccountClaRequestDialogComponent extends ContactClaManagerComponent {
  protected readonly request = inject<AccountClaRequestDialogData>(DIALOG_DATA);
  protected readonly heading = ACCOUNT_CLAS_COPY.requestTitles[this.request.mode];
  protected readonly placeholder = ACCOUNT_CLAS_COPY.messagePlaceholder;
  protected readonly company = this.request.agreement.companyName ?? '';
  protected readonly project = this.request.agreement.projectName || this.request.agreement.claGroupName;
  protected readonly messageErrorText: Signal<string> = computed(() => {
    const error = this.visibleMessageError();
    if (error === 'required') return 'A message is required.';
    if (error === 'too-long') return `Message must be ${this.messageMaxLength} characters or fewer.`;
    return '';
  });
  /** The company's Corporate CLA Console page for this project, when it can be managed there. */
  protected readonly consoleUrl = canManageInCclaConsole(this.request.agreement)
    ? cclaConsoleUrl(environment.urls.corporateConsole, this.request.agreement.foundationSfid, this.request.agreement.projectSfid)
    : '';
}
