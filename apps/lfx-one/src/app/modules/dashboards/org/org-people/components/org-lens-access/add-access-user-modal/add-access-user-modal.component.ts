// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Cursor](https://cursor.com)

import { Component, computed, input, model, output, signal, type Signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { EMAIL_REGEX } from '@lfx-one/shared/constants';
import type { OrgAccessInviteFormValue, OrgAccessRole, OrgAccessRoleOption } from '@lfx-one/shared/interfaces';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';

/** Add Users modal — invite a new principal by email with a role (Admin/Viewer); the grant lands as a pending invite. */
@Component({
  selector: 'lfx-add-access-user-modal',
  standalone: true,
  imports: [FormsModule, DialogModule, InputTextModule, SelectModule],
  templateUrl: './add-access-user-modal.component.html',
})
export class AddAccessUserModalComponent {
  /** Two-way dialog visibility. */
  public readonly visible = model<boolean>(false);
  /** Pessimistic write in progress — disables controls and shows a spinner. */
  public readonly saving = input<boolean>(false);

  /** Emits the invite payload when the form is submitted. */
  public readonly invite = output<OrgAccessInviteFormValue>();

  protected readonly email = signal<string>('');
  protected readonly name = signal<string>('');
  protected readonly role = signal<OrgAccessRole>('viewer');

  protected readonly roleOptions: OrgAccessRoleOption[] = [
    { label: 'Admin', value: 'admin', disabled: false },
    { label: 'Viewer', value: 'viewer', disabled: false },
  ];

  protected readonly emailValid: Signal<boolean> = computed(() => EMAIL_REGEX.test(this.email().trim()));
  protected readonly showEmailError: Signal<boolean> = computed(() => this.email().trim().length > 0 && !this.emailValid());
  protected readonly canSend: Signal<boolean> = computed(() => !this.saving() && this.emailValid());

  /** Reset the form each time the dialog opens (p-dialog onShow). */
  protected onShow(): void {
    this.email.set('');
    this.name.set('');
    this.role.set('viewer');
  }

  protected onSend(): void {
    if (!this.canSend()) return;
    this.invite.emit({
      email: this.email().trim().toLowerCase(),
      role: this.role(),
      name: this.name().trim() || null,
    });
  }

  protected onCancel(): void {
    if (this.saving()) return;
    this.visible.set(false);
  }
}
