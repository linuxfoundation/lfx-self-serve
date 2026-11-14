// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, inject, input, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { TextareaComponent } from '@components/textarea/textarea.component';
import { COMMITTEE_LABEL } from '@lfx-one/shared/constants';
import { Committee, ParentCommitteeOption } from '@lfx-one/shared/interfaces';
import { buildParentCommitteeOptions } from '@lfx-one/shared/utils';
import { CommitteeService } from '@services/committee.service';
import { ProjectContextService } from '@services/project-context.service';
import { filter, switchMap } from 'rxjs';

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
  public parentCommitteeOptions: Signal<ParentCommitteeOption[]> = this.initializeParentCommitteeOptions();

  private initializeParentCommitteeOptions(): Signal<ParentCommitteeOption[]> {
    const committees = toSignal(
      toObservable(this.projectContextService.activeContext).pipe(
        filter((ctx) => !!ctx?.uid),
        switchMap((ctx) => this.committeeService.getCommitteesByProject(ctx!.uid))
      ),
      { initialValue: [] as Committee[] }
    );

    return computed(() => buildParentCommitteeOptions(committees(), this.committeeId(), this.committeeLabel));
  }
}
