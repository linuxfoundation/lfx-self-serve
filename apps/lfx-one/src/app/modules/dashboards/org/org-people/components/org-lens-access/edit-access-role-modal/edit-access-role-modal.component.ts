// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, effect, input, linkedSignal, model, output, type Signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ORG_ACCESS_ROLE_BADGE_LABEL } from '@lfx-one/shared/constants';
import type { OrgAccessRole, OrgAccessRoleOption, OrgAccessUser } from '@lfx-one/shared/interfaces';
import { DialogModule } from 'primeng/dialog';
import { SelectModule } from 'primeng/select';
import { TooltipModule } from 'primeng/tooltip';

/** Edit role modal — read-only Current Access + a Change-to dropdown (Admin/Viewer); Viewer is disabled for the last accepted Admin (spec 025 US2, FR-010). */
@Component({
  selector: 'lfx-edit-access-role-modal',
  standalone: true,
  imports: [FormsModule, DialogModule, SelectModule, TooltipModule],
  templateUrl: './edit-access-role-modal.component.html',
})
export class EditAccessRoleModalComponent {
  /** The principal being edited (drives the current-access label + seed role). */
  public readonly user = input<OrgAccessUser | null>(null);
  /** Two-way dialog visibility. */
  public readonly visible = model<boolean>(false);
  /** Pessimistic write in progress — disables controls and shows a spinner. */
  public readonly saving = input<boolean>(false);
  /** When true, the Viewer option is disabled (downgrading the last Admin is blocked). */
  public readonly disableViewerOption = input<boolean>(false);

  /** Emits the chosen target role when the user saves. */
  public readonly save = output<OrgAccessRole>();

  protected readonly roleBadgeLabel = ORG_ACCESS_ROLE_BADGE_LABEL;

  /** Re-seeds to the principal's current role each time a new user is opened. */
  protected readonly selectedRole = linkedSignal<OrgAccessRole>(() => this.user()?.role ?? 'viewer');

  protected readonly currentAccessLabel: Signal<string> = computed(() => {
    const role = this.user()?.role;
    return role ? ORG_ACCESS_ROLE_BADGE_LABEL[role] : '';
  });

  protected readonly roleOptions: Signal<OrgAccessRoleOption[]> = computed(() => [
    { label: 'Admin', value: 'admin', disabled: false },
    { label: 'Viewer', value: 'viewer', disabled: this.disableViewerOption() },
  ]);

  protected readonly lastAdminNotice: Signal<boolean> = computed(() => this.disableViewerOption() && this.user()?.role === 'admin');

  protected readonly canSave: Signal<boolean> = computed(() => {
    const current = this.user()?.role;
    return !this.saving() && !!current && this.selectedRole() !== current;
  });

  public constructor() {
    // Re-seed the pending selection whenever the dialog closes — covers ALL close paths (Cancel
    // button, dismissableMask click-outside, ESC), not just onCancel(). Without this, a discarded
    // selection survives a same-user re-open because linkedSignal won't re-evaluate on an unchanged
    // user() reference, leaving canSave() true and risking an unintended role change.
    effect(() => {
      if (!this.visible()) {
        this.selectedRole.set(this.user()?.role ?? 'viewer');
      }
    });
  }

  protected onSave(): void {
    if (!this.canSave()) return;
    this.save.emit(this.selectedRole());
  }

  protected onCancel(): void {
    if (this.saving()) return;
    this.visible.set(false);
  }
}
