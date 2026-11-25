// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, Signal } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { ACCOUNT_EMAIL_SETTINGS_COPY } from '@lfx-one/shared/constants';
import { AccountDeleteEmailDialogData, AccountEmailRow } from '@lfx-one/shared/interfaces';
import { AccountCardComponent } from '@shared/components/account-card/account-card.component';
import { OpenIntercomDirective } from '@shared/directives/open-intercom.directive';
import { UiBadgeComponent } from '@shared/uikit/badge/badge.component';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiInputComponent } from '@shared/uikit/input/input.component';
import { UiMenuItemComponent } from '@shared/uikit/menu/menu-item.component';
import { UiMenuComponent } from '@shared/uikit/menu/menu.component';
import { UiModalService } from '@shared/uikit/modal/modal.service';
import { UiNoteComponent } from '@shared/uikit/note/note.component';
import { UiSkeletonComponent } from '@shared/uikit/skeleton/skeleton.component';
import { DialogService } from 'primeng/dynamicdialog';
import { take } from 'rxjs';

import { AccountSettingsComponent } from '../../settings/account-settings/account-settings.component';
import { AccountDeleteEmailDialogComponent } from './delete-email-dialog/account-delete-email-dialog.component';

/**
 * Account & Settings › Email settings (#6079): one "Email Addresses" card with a ⋯ menu per address and the add flow below.
 * It keeps the settings page's email loading, guards and Flow C round trips by extending it, and asks before a delete in its
 * own dialog.
 */
@Component({
  selector: 'lfx-account-email-settings',
  imports: [
    ReactiveFormsModule,
    AccountCardComponent,
    OpenIntercomDirective,
    UiBadgeComponent,
    UiButtonComponent,
    UiInputComponent,
    UiMenuComponent,
    UiMenuItemComponent,
    UiNoteComponent,
    UiSkeletonComponent,
  ],
  // The settings page opens its token dialogs through PrimeNG's, which this page never shows; toasts go to the app's own.
  providers: [DialogService],
  templateUrl: './account-email-settings.component.html',
})
export class AccountEmailSettingsComponent extends AccountSettingsComponent {
  private readonly modal = inject(UiModalService);

  protected readonly copy = ACCOUNT_EMAIL_SETTINGS_COPY;
  protected readonly rows: Signal<AccountEmailRow[]> = this.initRows();

  protected override confirmDeleteEmail(email: string, accept: () => void, reject: () => void): void {
    this.modal
      .open<boolean, AccountDeleteEmailDialogData>(AccountDeleteEmailDialogComponent, { data: { email }, role: 'alertdialog' })
      .closed.pipe(take(1))
      .subscribe((confirmed) => (confirmed ? accept() : reject()));
  }

  private initRows(): Signal<AccountEmailRow[]> {
    return computed(() => {
      // Every row's items wait on a write in flight, as on the settings page, so a second row can't queue a competing one.
      const savingInvite = this.savingMeetingInvite();
      const deleting = this.deletingEmailAddress() !== null;
      const inviteLoadFailed = this.meetingInviteLoadFailed();
      return this.emailsWithMetadata().map((item) => {
        const showDelete = item.isPrimary || item.canDelete;
        return {
          email: item,
          isPrimary: item.isPrimary,
          isMeetingInvite: item.isMeetingInvite,
          canMakePrimary: item.canSetPrimary,
          canSetMeetingInvite: item.canSetMeetingInvite,
          meetingInviteBusy: savingInvite,
          showDelete,
          deleteBlockedReason: this.deleteReason(item.isPrimary, item.isInviteOverride, savingInvite, inviteLoadFailed, deleting),
          hasActions: item.canSetPrimary || item.canSetMeetingInvite || showDelete,
        };
      });
    });
  }

  /** The design's reasons for the primary and the meeting-invitation address; the settings page's for a write in flight. */
  private deleteReason(isPrimary: boolean, isInviteOverride: boolean, savingInvite: boolean, inviteLoadFailed: boolean, deleting: boolean): string {
    if (isPrimary) return this.copy.deletePrimaryReason;
    const inFlight = this.getDeleteBlockedReason(false, savingInvite, inviteLoadFailed, deleting);
    if (inFlight) return inFlight;
    return isInviteOverride ? this.copy.deleteInviteReason : '';
  }
}
