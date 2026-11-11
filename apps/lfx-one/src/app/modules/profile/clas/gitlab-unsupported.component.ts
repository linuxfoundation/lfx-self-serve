// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { GITLAB_UNSUPPORTED_MESSAGE } from '@lfx-one/shared/constants';
import { DynamicDialogRef } from 'primeng/dynamicdialog';

import { ButtonComponent } from '@components/button/button.component';

/**
 * Why a CLA group linked only to GitLab cannot be signed from here (#2002).
 *
 * GitLab account linking and verified display are supported in Profile → Identities.
 * The CLA signing flow does not yet implement GitLab identity selection or the signing
 * handoff; connecting an account alone does not make a GitLab-only group signable here.
 *
 * The block is structural: there is no continue action to disable, because a disabled control
 * implies a condition the contributor could satisfy, and there is none. It stops them inside
 * the flow rather than navigating, so the CLA group they chose is still chosen — the same
 * reasoning as the sign identity step's own empty state (#1917).
 *
 * A GitLab-linked group is still listed in search. Hiding it would make a project that exists
 * indistinguishable from one that does not, and the upstream search cache can lag half an hour.
 *
 * Closes with nothing. There is no outcome to report: every exit is the same exit.
 */
@Component({
  selector: 'lfx-gitlab-unsupported',
  imports: [ButtonComponent],
  templateUrl: './gitlab-unsupported.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GitlabUnsupportedComponent {
  private readonly ref = inject(DynamicDialogRef);

  protected readonly message = GITLAB_UNSUPPORTED_MESSAGE;

  protected onClose(): void {
    this.ref.close(null);
  }
}
