// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, type Signal } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import type { ComposerGroupRow, ComposerVotingStatusOption } from '@lfx-one/shared/interfaces';
import { composerGroupMeta } from '@lfx-one/shared/utils';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiCheckboxComponent } from '@shared/uikit/checkbox/checkbox.component';
import { UiMultiSelectComponent } from '@shared/uikit/multi-select/multi-select.component';
import { UiNoteComponent } from '@shared/uikit/note/note.component';
import { UiOptionComponent } from '@shared/uikit/select/option.component';
import { UiSelectComponent } from '@shared/uikit/select/select.component';

import { MeetingCommitteeManagerComponent } from '../../../components/meeting-committee-manager/meeting-committee-manager.component';

/**
 * Groups picker of the redesigned composer's Invite guests section: the committee manager's state and member sync, in the new layout.
 * @description Each selected group carries a small menu with the voting-status filter and the registration-on-removal setting. Both are
 * meeting-wide, as in the manager, so the menu says so when more than one group shares them.
 */
@Component({
  selector: 'lfx-composer-group-picker',
  imports: [ReactiveFormsModule, UiButtonComponent, UiCheckboxComponent, UiMultiSelectComponent, UiNoteComponent, UiOptionComponent, UiSelectComponent],
  templateUrl: './composer-group-picker.component.html',
})
export class ComposerGroupPickerComponent extends MeetingCommitteeManagerComponent {
  protected readonly committeeLabelPluralLower = this.committeeLabel.plural.toLowerCase();
  protected readonly committeesControl = this.committeeForm.get('committees') as FormControl<string[]>;

  protected readonly optionRows: Signal<ComposerGroupRow[]> = this.initOptionRows();
  protected readonly selectedRows: Signal<ComposerGroupRow[]> = this.initSelectedRows();
  protected readonly votingGroupCount: Signal<number> = computed(() => this.selectedRows().filter((row) => row.voting).length);
  protected readonly votingStatusRows: Signal<ComposerVotingStatusOption[]> = computed(() => {
    const selected = this.selectedVotingStatuses();
    return this.votingStatusOptions.map((status) => ({ ...status, checked: selected.includes(status.value) }));
  });
  protected readonly cancelOnRemovalControl: Signal<FormControl<string>> = computed(
    () => this.form().get('cancel_on_committee_removal') as FormControl<string>
  );

  protected onVotingStatusChange(status: string, checked: boolean): void {
    const current = this.selectedVotingStatuses().filter((value) => value !== status);
    this.committeeForm.get('votingStatuses')?.setValue(checked ? [...current, status] : current);
  }

  private initOptionRows(): Signal<ComposerGroupRow[]> {
    return computed(() =>
      this.committeeOptions().map((committee) => ({
        uid: committee.uid,
        name: committee.name,
        meta: composerGroupMeta(committee),
        voting: committee.enable_voting === true,
      }))
    );
  }

  /** The locked group of a group-scoped create, or the picked groups; voting falls back to the selection's filter when options are missing. */
  private initSelectedRows(): Signal<ComposerGroupRow[]> {
    return computed(() => {
      const options = this.committeeOptions();
      const context = this.committeeContext();
      const fallbackVoting = this.hasVotingEnabledCommittee();
      const toRow = (uid: string, name: string): ComposerGroupRow => {
        const option = options.find((committee) => committee.uid === uid);
        return { uid, name, meta: composerGroupMeta(option ?? context ?? undefined), voting: option ? option.enable_voting === true : fallbackVoting };
      };

      if (context) {
        return [toRow(context.uid, context.name)];
      }
      return this.selectedCommitteeChips().map((chip) => toRow(chip.uid, chip.name ?? chip.uid));
    });
  }
}
