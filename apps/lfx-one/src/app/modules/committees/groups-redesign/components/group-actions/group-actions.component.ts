// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Clipboard } from '@angular/cdk/clipboard';
import { DialogRef } from '@angular/cdk/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, input, Signal, signal, TemplateRef, viewChild } from '@angular/core';
import { environment } from '@environments/environment';
import { BEHAVIORAL_CLASS_CONFIG } from '@lfx-one/shared/constants';
import { MeetingHomeRowProject, MyCommittee } from '@lfx-one/shared/interfaces';
import { getMeetingHomeRowProject } from '@lfx-one/shared/utils';
import { CommitteeService } from '@services/committee.service';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiMenuItemComponent } from '@shared/uikit/menu/menu-item.component';
import { UiMenuComponent } from '@shared/uikit/menu/menu.component';
import { UiModalComponent } from '@shared/uikit/modal/modal.component';
import { UiModalService } from '@shared/uikit/modal/modal.service';
import { UiToastService } from '@shared/uikit/toast/toast.service';
import { committeeLeaveErrorMessage } from '@shared/utils/http-error.utils';

import { MeetingProjectLogoComponent } from '../../../../meetings/meetings-redesign/components/meeting-project-logo/meeting-project-logo.component';
import { GroupsHomeStore } from '../../services/groups-home.store';

/** The "…" menu of a group on the Groups page: Copy group link for a public group, and Leave group behind a confirmation. */
@Component({
  selector: 'lfx-group-actions',
  imports: [UiButtonComponent, UiMenuComponent, UiMenuItemComponent, UiModalComponent, MeetingProjectLogoComponent],
  templateUrl: './group-actions.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'contents' },
})
export class GroupActionsComponent {
  private readonly committeeService = inject(CommitteeService);
  private readonly store = inject(GroupsHomeStore);
  private readonly modal = inject(UiModalService);
  private readonly toast = inject(UiToastService);
  private readonly clipboard = inject(Clipboard);
  private readonly leaveDialog = viewChild.required<TemplateRef<unknown>>('leaveDialog');
  private dialogRef: DialogRef | null = null;

  public readonly group = input.required<MyCommittee>();
  /** `small` (28px) on cards, `default` (32px) in the table. */
  public readonly size = input<'small' | 'default'>('default');

  protected readonly leaving = signal(false);
  protected readonly project: Signal<MeetingHomeRowProject | null> = computed(() => getMeetingHomeRowProject(this.group()));
  /** Type, member count and visibility under the group's name in the dialog. */
  protected readonly meta: Signal<string> = this.initMeta();

  public constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.leaving.set(false);
      this.dialogRef?.close();
    });
  }

  protected copyLink(): void {
    const group = this.group();
    const url = `${environment.urls.home}/groups/${encodeURIComponent(group.sso_group_name || group.uid)}`;
    if (!this.clipboard.copy(url)) {
      this.toast.show({ variant: 'error', message: 'Copy Failed', description: 'Failed to copy link. Please try again.' });
      return;
    }
    this.toast.show({ variant: 'dark', message: 'Link copied' });
  }

  protected confirmLeave(): void {
    // Nothing closes the dialog while the leave runs, since closing would not stop it.
    this.dialogRef = this.modal.open(
      this.leaveDialog(),
      { role: 'alertdialog', describedBy: true, autoFocus: '[data-autofocus] button' },
      { closePredicate: () => !this.leaving() }
    );
  }

  protected leave(): void {
    if (this.leaving()) return;
    const group = this.group();
    const ref = this.dialogRef;
    this.leaving.set(true);
    this.committeeService.leaveCommittee(group.uid).subscribe({
      next: () => {
        this.leaving.set(false);
        ref?.close();
        this.store.removeGroup(group.uid);
        this.toast.show({ variant: 'dark', message: `You have left "${group.name}"` });
      },
      // The dialog stays open so the viewer can try again or cancel.
      error: (error: HttpErrorResponse) => {
        this.leaving.set(false);
        this.toast.show({ variant: 'error', message: 'Unable to Leave', description: committeeLeaveErrorMessage(error, group.name) });
      },
    });
  }

  private initMeta(): Signal<string> {
    return computed(() => {
      const group = this.group();
      const type = group.category?.trim() || BEHAVIORAL_CLASS_CONFIG[group.behavioralClass ?? 'other'].label;
      const members = group.total_members ?? 0;
      return [type, `${members.toLocaleString('en-US')} ${members === 1 ? 'member' : 'members'}`, group.public ? 'Public' : 'Private'].join(' · ');
    });
  }
}
