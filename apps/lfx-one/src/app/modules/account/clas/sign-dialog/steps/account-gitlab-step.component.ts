// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component } from '@angular/core';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiNoteComponent } from '@shared/uikit/note/note.component';

import { GitlabUnsupportedComponent } from '../../../../profile/clas/gitlab-unsupported.component';

/** The GitLab step of the Account & Settings "Sign a CLA" dialog (#6077): this flow can't sign a GitLab-only CLA group. */
@Component({
  selector: 'lfx-account-gitlab-step',
  imports: [UiButtonComponent, UiNoteComponent],
  templateUrl: './account-gitlab-step.component.html',
  host: { class: 'flex flex-col gap-[16px]' },
})
export class AccountGitlabStepComponent extends GitlabUnsupportedComponent {}
