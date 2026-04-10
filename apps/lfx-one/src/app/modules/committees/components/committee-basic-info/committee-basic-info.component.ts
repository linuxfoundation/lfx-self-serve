// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { TextareaComponent } from '@components/textarea/textarea.component';
import { COMMITTEE_LABEL } from '@lfx-one/shared/constants';
import { Committee } from '@lfx-one/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import { ProjectContextService } from '@services/project-context.service';
import { catchError, filter, map, of, switchMap } from 'rxjs';

@Component({
  selector: 'lfx-committee-basic-info',
  imports: [ReactiveFormsModule, InputTextComponent, SelectComponent, TextareaComponent],
  templateUrl: './committee-basic-info.component.html',
})
export class CommitteeBasicInfoComponent {
  private readonly committeeService = inject(CommitteeService);
  private readonly projectContextService = inject(ProjectContextService);

  // Signal inputs
  public form = input.required<FormGroup>();
  public committeeId = input<string | null>(null);

  // UI labels
  public readonly committeeLabel = COMMITTEE_LABEL.singular;

  // Load parent committee options — reactive to project context changes
  public parentCommitteeOptions: Signal<{ label: string; value: string | null }[]> = this.initializeParentCommitteeOptions();

  private initializeParentCommitteeOptions(): Signal<{ label: string; value: string | null }[]> {
    const committees = toSignal(
      toObservable(this.projectContextService.activeContext).pipe(
        filter((ctx) => !!ctx?.uid),
        switchMap((ctx) =>
          this.committeeService.getCommitteesByProject(ctx!.uid).pipe(
            map((committees: Committee[]) => {
              const topLevelCommittees = committees.filter((committee) => !committee.parent_uid);
              const currentCommitteeId = this.committeeId();
              return currentCommitteeId ? topLevelCommittees.filter((committee) => committee.uid !== currentCommitteeId) : topLevelCommittees;
            }),
            catchError(() => of([] as Committee[]))
          )
        )
      ),
      { initialValue: [] }
    );

    return computed(() => {
      const options = committees().map((committee) => ({
        label: committee.display_name || committee.name,
        value: committee.uid,
      }));

      return [{ label: 'No Parent ' + this.committeeLabel, value: null }, ...options];
    });
  }
}
