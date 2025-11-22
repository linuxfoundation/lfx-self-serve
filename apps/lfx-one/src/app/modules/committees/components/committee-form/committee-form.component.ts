// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, computed, inject, input, output, Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { TextareaComponent } from '@components/textarea/textarea.component';
import { ToggleComponent } from '@components/toggle/toggle.component';
import { COMMITTEE_LABEL, FILTERED_COMMITTEE_CATEGORIES } from '@lfx-one/shared/constants';
import { Committee } from '@lfx-one/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import { ProjectContextService } from '@services/project-context.service';
import { TooltipModule } from 'primeng/tooltip';
import { map } from 'rxjs';

@Component({
  selector: 'lfx-committee-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, InputTextComponent, SelectComponent, TextareaComponent, ToggleComponent, TooltipModule, ButtonComponent],
  templateUrl: './committee-form.component.html',
  styleUrl: './committee-form.component.scss',
})
export class CommitteeFormComponent {
  private readonly committeeService = inject(CommitteeService);
  private readonly projectContextService = inject(ProjectContextService);

  // Signal inputs
  public form = input.required<FormGroup>();
  public isEditMode = input.required<boolean>();
  public committeeId = input<string | null>(null);
  public submitting = input.required<boolean>();

  // Signal outputs
  public readonly formSubmit = output<void>();
  public readonly formCancel = output<void>();

  // Category options from constants (using filtered list)
  public readonly categoryOptions = FILTERED_COMMITTEE_CATEGORIES;

  // Load parent committee options
  public parentCommitteeOptions: Signal<{ label: string; value: string | null }[]> = this.initializeParentCommitteeOptions();

  public readonly committeeLabel = COMMITTEE_LABEL.singular;

  public onSubmit(): void {
    this.formSubmit.emit();
  }

  public onCancel(): void {
    this.formCancel.emit();
  }

  private initializeParentCommitteeOptions(): Signal<{ label: string; value: string | null }[]> {
    // Get project ID from context (project or foundation)
    const uid = this.projectContextService.getProjectUid() || this.projectContextService.getFoundationId();

    const committees = toSignal(
      this.committeeService.getCommitteesByProject(uid).pipe(
        map((committees: Committee[]) => {
          // Filter to only top-level committees (no parent_uid)
          const topLevelCommittees = committees.filter((committee) => !committee.parent_uid);

          // If editing, exclude the current committee
          const currentCommitteeId = this.committeeId();
          const availableCommittees = currentCommitteeId ? topLevelCommittees.filter((committee) => committee.uid !== currentCommitteeId) : topLevelCommittees;

          return availableCommittees;
        })
      ),
      { initialValue: [] }
    );

    return computed(() => {
      const options = committees().map((committee) => ({
        label: committee.display_name || committee.name,
        value: committee.uid,
      }));

      // Add "No Parent Group" option at the beginning
      return [{ label: 'No Parent ' + this.committeeLabel, value: null }, ...options];
    });
  }
}
