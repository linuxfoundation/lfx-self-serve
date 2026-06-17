// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { inject, Injectable } from '@angular/core';
import {
  AcceptInviteOrganizationDialogComponent,
  AcceptInviteOrganizationDialogData,
  AcceptInviteOrganizationDialogResult,
} from '@components/accept-invite-organization-dialog/accept-invite-organization-dialog.component';
import { CommitteeOrganizationReference } from '@lfx-one/shared/interfaces';
import { invitationRequiresOrganization } from '@lfx-one/shared/utils';
import { InvitationService } from '@services/invitation.service';
import { DialogService } from 'primeng/dynamicdialog';
import { EMPTY, Observable, from, switchMap, take } from 'rxjs';

/** Context needed to accept a committee invitation from any surface. */
export interface InvitationAcceptContext {
  committeeUid: string;
  inviteUid: string;
  committeeName: string;
  organization?: CommitteeOrganizationReference | null;
  enable_voting?: boolean;
  business_email_required?: boolean;
  inviteRequiresOrganization?: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class InvitationAcceptFlowService {
  private readonly dialogService = inject(DialogService);
  private readonly invitationService = inject(InvitationService);

  /**
   * Accepts a committee invitation, opening the organization dialog when the committee
   * requires it. Emits nothing when the user cancels the dialog.
   */
  public accept(context: InvitationAcceptContext): Observable<void> {
    const requiresOrganization = invitationRequiresOrganization(context);

    if (!requiresOrganization) {
      return this.invitationService.acceptInvitation(context.committeeUid, context.inviteUid);
    }

    return from(this.openOrganizationDialog(context)).pipe(
      switchMap((result) => {
        if (!result?.organization) {
          return EMPTY;
        }
        return this.invitationService.acceptInvitation(context.committeeUid, context.inviteUid, result.organization);
      })
    );
  }

  private openOrganizationDialog(context: InvitationAcceptContext): Promise<AcceptInviteOrganizationDialogResult | null> {
    const ref = this.dialogService.open(AcceptInviteOrganizationDialogComponent, {
      header: 'Confirm Organization',
      width: '32rem',
      modal: true,
      closable: true,
      data: {
        committeeName: context.committeeName,
        organization: context.organization ?? null,
      } satisfies AcceptInviteOrganizationDialogData,
    });

    if (!ref) {
      return Promise.resolve(null);
    }

    return new Promise((resolve) => {
      ref.onClose.pipe(take(1)).subscribe((result: AcceptInviteOrganizationDialogResult | null) => resolve(result ?? null));
    });
  }
}
