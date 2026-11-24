// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, Signal } from '@angular/core';
import { AccountCardComponent } from '@components/account-card/account-card.component';
import { ACCOUNT_IDENTITIES_COPY, ACCOUNT_IDENTITIES_PATH } from '@lfx-one/shared/constants';
import { ConnectedIdentityFull, RemoveIdentityDialogData, VerifyIdentityDialogData } from '@lfx-one/shared/interfaces';
import { OpenIntercomDirective } from '@shared/directives/open-intercom.directive';
import { UiBadgeComponent } from '@shared/uikit/badge/badge.component';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiEmptyStateComponent } from '@shared/uikit/empty-state/empty-state.component';
import { UiMenuItemComponent } from '@shared/uikit/menu/menu-item.component';
import { UiMenuComponent } from '@shared/uikit/menu/menu.component';
import { UiModalService } from '@shared/uikit/modal/modal.service';
import { UiNoteComponent } from '@shared/uikit/note/note.component';
import { UiSkeletonComponent } from '@shared/uikit/skeleton/skeleton.component';
import { DialogService } from 'primeng/dynamicdialog';
import { Observable } from 'rxjs';

import { ProfileIdentitiesComponent } from '../../profile/identities/profile-identities.component';
import { ProfileLinuxEmailComponent } from '../../profile/linux-email/profile-linux-email.component';
import { AccountAddIdentityDialogComponent } from './components/add-identity-dialog/account-add-identity-dialog.component';
import { AccountRemoveIdentityDialogComponent } from './components/remove-identity-dialog/account-remove-identity-dialog.component';
import { AccountVerifyIdentityDialogComponent } from './components/verify-identity-dialog/account-verify-identity-dialog.component';

/**
 * Account & Settings › Identities (#6074, behind the profile redesign flag). It keeps the hub page's loading, callback handling and
 * removal guards by extending it, and swaps in the new layout and uikit dialogs. When the hub goes (#6094), that logic moves here.
 */
@Component({
  selector: 'lfx-account-identities',
  imports: [
    NgTemplateOutlet,
    AccountCardComponent,
    OpenIntercomDirective,
    ProfileLinuxEmailComponent,
    UiBadgeComponent,
    UiButtonComponent,
    UiEmptyStateComponent,
    UiMenuComponent,
    UiMenuItemComponent,
    UiNoteComponent,
    UiSkeletonComponent,
  ],
  // The hub page injects PrimeNG's DialogService; nothing here opens one.
  providers: [DialogService],
  templateUrl: './account-identities.component.html',
})
export class AccountIdentitiesComponent extends ProfileIdentitiesComponent {
  private readonly modal = inject(UiModalService);

  protected override readonly authReturnPath = ACCOUNT_IDENTITIES_PATH;
  protected readonly copy = ACCOUNT_IDENTITIES_COPY;
  /** Why each verified identity can't be removed, keyed by id; absent when it can. */
  protected readonly removeBlockedReasons: Signal<Map<string, string>> = this.initRemoveBlockedReasons();
  protected readonly hasAny: Signal<boolean> = computed(() => !this.loading() && this.identities().length > 0);

  public override onVerify(identity: ConnectedIdentityFull): void {
    this.refreshOnClose(this.modal.open<boolean>(AccountVerifyIdentityDialogComponent, { data: { identity } satisfies VerifyIdentityDialogData }).closed);
  }

  public override onAdd(): void {
    this.refreshOnClose(this.modal.open<boolean>(AccountAddIdentityDialogComponent).closed);
  }

  protected override openRemoveDialog(identity: ConnectedIdentityFull): void {
    this.modal
      .open<boolean>(AccountRemoveIdentityDialogComponent, {
        role: 'alertdialog',
        autoFocus: '[data-autofocus] button',
        data: { identity } satisfies RemoveIdentityDialogData,
      })
      .closed.subscribe((remove) => {
        if (remove) this.removeIdentity(identity);
      });
  }

  // The primary email can't go from here: it is the sign-in address and gets meeting invites. The meeting-invite address can't go
  // either, nor any email while that address is unknown; the hub's guard decides those.
  private initRemoveBlockedReasons(): Signal<Map<string, string>> {
    return computed(() => {
      const reasons = new Map<string, string>();
      for (const identity of this.verifiedIdentities()) {
        if (identity.isPrimary && !identity.auth0UserId) {
          reasons.set(identity.id, ACCOUNT_IDENTITIES_COPY.primaryEmailRemoveReason);
        } else if (this.isMeetingInviteIdentity(identity)) {
          reasons.set(
            identity.id,
            this.identitiesState().inviteLoadFailed
              ? 'Could not confirm your meeting-invitation email. Reload the page before removing an email address.'
              : 'This email is set for meeting invitations. Choose a different one in Email settings before removing it.'
          );
        }
      }
      return reasons;
    });
  }

  private refreshOnClose(closed: Observable<boolean | undefined>): void {
    closed.subscribe((linked) => {
      if (linked) this.userService.refreshUserIdentities();
    });
  }
}
