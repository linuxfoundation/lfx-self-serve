// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { RadioButtonComponent } from '@components/radio-button/radio-button.component';
import { GroupsIOMailingList, VoteMailingListReminderDialogData, VoteMailingListReminderListOption } from '@lfx-one/shared/interfaces';
import { getMailingListEmail } from '@lfx-one/shared/utils';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';

/**
 * Asks which mailing list to draft a vote reminder to when the committee has several (#3658).
 * Closes with the chosen list; the votes table opens the `mailto:` draft. None is preselected,
 * so a wrong list can't be picked silently.
 */
@Component({
  selector: 'lfx-vote-mailing-list-reminder-dialog',
  imports: [ButtonComponent, RadioButtonComponent, ReactiveFormsModule],
  templateUrl: './vote-mailing-list-reminder-dialog.component.html',
})
export class VoteMailingListReminderDialogComponent {
  // === Injections ===
  private readonly config = inject<DynamicDialogConfig<VoteMailingListReminderDialogData>>(DynamicDialogConfig);
  private readonly ref = inject(DynamicDialogRef);

  // === Dialog data ===
  protected readonly voteName: string = this.config.data!.vote.name;
  private readonly lists: GroupsIOMailingList[] = this.config.data!.lists;
  protected readonly listOptions: VoteMailingListReminderListOption[] = this.lists.map((list) => ({
    uid: list.uid,
    label: `${list.group_name} (${getMailingListEmail(list)})`,
  }));

  // === Forms ===
  protected readonly listForm = new FormGroup({ listUid: new FormControl<string | null>(null) });

  // === Computed signals ===
  private readonly selectedListUid: Signal<string | null> = this.initSelectedListUid();
  protected readonly selectedList: Signal<GroupsIOMailingList | null> = computed(() => this.lists.find((list) => list.uid === this.selectedListUid()) ?? null);

  // === Protected methods ===
  protected openInEmail(): void {
    const list = this.selectedList();
    if (list) {
      this.ref.close(list);
    }
  }

  protected cancel(): void {
    this.ref.close();
  }

  // === Private initializers ===
  private initSelectedListUid(): Signal<string | null> {
    const control = this.listForm.controls.listUid;
    return toSignal(control.valueChanges, { initialValue: control.value });
  }
}
