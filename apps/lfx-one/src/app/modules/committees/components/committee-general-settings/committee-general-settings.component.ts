// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { COMMITTEE_LABEL } from '@lfx-one/shared/constants';
import { Committee, ParentCommitteeOption } from '@lfx-one/shared/interfaces';
import { buildParentCommitteeOptions, getEditableCommitteeCategories } from '@lfx-one/shared/utils';
import { CommitteeService } from '@services/committee.service';
import { PersonaService } from '@services/persona.service';
import { filter, switchMap } from 'rxjs';

@Component({
  selector: 'lfx-committee-general-settings',
  imports: [ReactiveFormsModule, InputTextComponent, SelectComponent],
  templateUrl: './committee-general-settings.component.html',
})
export class CommitteeGeneralSettingsComponent {
  private readonly committeeService = inject(CommitteeService);
  private readonly personaService = inject(PersonaService);

  // Signal inputs
  public readonly form = input.required<FormGroup>();
  public readonly committee = input.required<Committee>();

  // UI labels
  public readonly committeeLabel = COMMITTEE_LABEL.singular;

  /** Types the viewer may pick, plus the committee's current type when it falls outside that set so the select never renders blank. */
  public readonly categoryOptions = computed(() => getEditableCommitteeCategories(this.personaService.currentPersona(), this.committee().category));

  /** Top-level committees in the same project, excluding this one — a group can't be its own parent. */
  public readonly parentCommitteeOptions: Signal<ParentCommitteeOption[]> = this.initializeParentCommitteeOptions();

  private initializeParentCommitteeOptions(): Signal<ParentCommitteeOption[]> {
    // getCommitteesByProject already degrades to [] on error, so no component-level catchError.
    const committees = toSignal(
      toObservable(this.committee).pipe(
        filter((committee) => !!committee.project_uid),
        switchMap((committee) => this.committeeService.getCommitteesByProject(committee.project_uid))
      ),
      { initialValue: [] as Committee[] }
    );

    return computed(() => buildParentCommitteeOptions(committees(), this.committee().uid, this.committeeLabel));
  }
}
