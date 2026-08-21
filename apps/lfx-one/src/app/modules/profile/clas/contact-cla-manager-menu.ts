// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CLA_MANAGER_MODAL_COPY } from '@lfx-one/shared/constants';
import type { ContactClaManagerDialogData, MyClaAgreement } from '@lfx-one/shared/interfaces';
import { canContactClaManager, canRequestClaApproval, canRequestClaRemoval } from '@lfx-one/shared/utils';
import { MenuItem } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';

import { ContactClaManagerComponent } from './contact-cla-manager.component';

/**
 * Kebab items for Request approval / Request Removal / Contact CLA Manager.
 *
 * Returns `[]` for ICLA and Revoked, so it is safe to spread onto every row. Does not read
 * LaunchDarkly — invoke only when `my-clas-m2-enabled` is on. Does not edit profile-clas.
 */
export function buildContactClaManagerMenuItems(agreement: MyClaAgreement, dialog: DialogService): MenuItem[] {
  const items: MenuItem[] = [];
  const projectName = agreement.projectName || agreement.claGroupName;
  const open = (mode: ContactClaManagerDialogData['mode']): void => {
    const copy = CLA_MANAGER_MODAL_COPY[mode];
    dialog.open(ContactClaManagerComponent, {
      header: copy.title,
      width: '32rem',
      modal: true,
      closable: true,
      dismissableMask: true,
      data: { signatureId: agreement.id, projectName, mode } satisfies ContactClaManagerDialogData,
    });
  };

  if (canRequestClaApproval(agreement)) {
    items.push({
      label: CLA_MANAGER_MODAL_COPY.approval.title,
      icon: 'fa-light fa-circle-check',
      command: () => open('approval'),
    });
  }
  if (canRequestClaRemoval(agreement)) {
    items.push({
      label: CLA_MANAGER_MODAL_COPY.removal.title,
      icon: 'fa-light fa-user-slash',
      command: () => open('removal'),
    });
  }
  if (canContactClaManager(agreement)) {
    items.push({
      label: CLA_MANAGER_MODAL_COPY.contact.title,
      icon: 'fa-light fa-address-book',
      command: () => open('contact'),
    });
  }
  return items;
}
