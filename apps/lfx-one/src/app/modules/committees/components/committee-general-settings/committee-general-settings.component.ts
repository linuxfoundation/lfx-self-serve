// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { COMMITTEE_LABEL } from '@lfx-one/shared/constants';
import { Committee } from '@lfx-one/shared/interfaces';
import { getSelectableCommitteeCategories } from '@lfx-one/shared/utils';
import { CommitteeService } from '@services/committee.service';
import { PersonaService } from '@services/persona.service';
import { catchError, filter, map, of, switchMap } from 'rxjs';

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

  /** Types the viewer may pick, plus the committee's current type when it falls outside that set (e.g. a Maintainer viewing a TOC) so the select never renders blank. */
  public readonly categoryOptions = computed(() => {
    const options = getSelectableCommitteeCategories(this.personaService.currentPersona());
    const current = this.committee().category;
    return current && !options.some((option) => option.value === current) ? [{ label: current, value: current }, ...options] : options;
  });

  /** Top-level committees in the same project, excluding this one — a group can't be its own parent. */
  public readonly parentCommitteeOptions: Signal<{ label: string; value: string | null }[]> = this.initializeParentCommitteeOptions();

  private initializeParentCommitteeOptions(): Signal<{ label: string; value: string | null }[]> {
    const committees = toSignal(
      toObservable(this.committee).pipe(
        filter((committee) => !!committee.project_uid),
        switchMap((committee) =>
          this.committeeService.getCommitteesByProject(committee.project_uid).pipe(
            map((siblings: Committee[]) => siblings.filter((sibling) => !sibling.parent_uid && sibling.uid !== committee.uid)),
            catchError(() => of([] as Committee[]))
          )
        )
      ),
      { initialValue: [] as Committee[] }
    );

    return computed(() => [
      { label: 'No Parent ' + this.committeeLabel, value: null },
      ...committees().map((committee) => ({ label: committee.name, value: committee.uid })),
    ]);
  }
}
