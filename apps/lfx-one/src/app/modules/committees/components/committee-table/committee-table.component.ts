// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, inject, input, output, signal, Signal, WritableSignal } from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { TableComponent } from '@components/table/table.component';
import { TagComponent } from '@components/tag/tag.component';
import { Committee, COMMITTEE_LABEL } from '@lfx-one/shared';
import { CommitteeCategorySeverityPipe } from '@pipes/committee-category-severity.pipe';
import { CommitteeService } from '@services/committee.service';
import { PersonaService } from '@services/persona.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DialogService, DynamicDialogModule, DynamicDialogRef } from 'primeng/dynamicdialog';
import { TooltipModule } from 'primeng/tooltip';
import { take } from 'rxjs';

import { MemberFormComponent } from '../member-form/member-form.component';

@Component({
  selector: 'lfx-committee-table',
  imports: [
    DatePipe,
    DecimalPipe,
    ReactiveFormsModule,
    RouterLink,
    CardComponent,
    ButtonComponent,
    TableComponent,
    TagComponent,
    InputTextComponent,
    SelectComponent,
    TooltipModule,
    ConfirmDialogModule,
    DynamicDialogModule,
    CommitteeCategorySeverityPipe,
  ],
  providers: [ConfirmationService, DialogService],
  templateUrl: './committee-table.component.html',
  styleUrl: './committee-table.component.scss',
})
export class CommitteeTableComponent {
  // Injected services
  private readonly committeeService = inject(CommitteeService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly messageService = inject(MessageService);
  private readonly dialogService = inject(DialogService);
  private readonly personaService = inject(PersonaService);

  // Inputs
  public committees = input.required<Committee[]>();
  public canManageCommittee = input<boolean>(false);
  public myCommitteeUids = input<Set<string>>(new Set());
  public readonly committeeLabel = COMMITTEE_LABEL.singular;
  public readonly committeeLabelPlural = COMMITTEE_LABEL.plural;
  public searchForm = input.required<FormGroup>();
  public categoryOptions = input.required<{ label: string; value: string | null }[]>();
  public votingStatusOptions = input.required<{ label: string; value: string | null }[]>();

  // State
  public isDeleting: WritableSignal<boolean> = signal<boolean>(false);
  public isBoardMember: Signal<boolean> = computed(() => this.personaService.currentPersona() === 'board-member');

  // Outputs
  public readonly refresh = output<void>();
  public readonly rowClick = output<Committee>();
  public readonly joinClick = output<Committee>();
  public readonly inviteClick = output<Committee>();

  // Event handlers
  public onAddMember(committee: Committee): void {
    const dialogRef = this.dialogService.open(MemberFormComponent, {
      header: 'Add Member',
      width: '700px',
      modal: true,
      closable: true,
      data: {
        isEditing: false,
        committee: committee,
        onCancel: () => {
          // Dialog will close itself
        },
      },
    }) as DynamicDialogRef;

    dialogRef.onClose.pipe(take(1)).subscribe((result: boolean | undefined) => {
      if (result) {
        this.refresh.emit();
      }
    });
  }

  public onDeleteCommittee(committee: Committee): void {
    this.confirmationService.confirm({
      message: `Are you sure you want to delete the ${this.committeeLabel.toLowerCase()} "${committee.name}"? This action cannot be undone.`,
      header: `Delete ${this.committeeLabel}`,
      acceptLabel: 'Delete',
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: 'p-button-danger p-button-sm',
      rejectButtonStyleClass: 'p-button-outlined p-button-sm',
      accept: () => this.performDelete(committee),
    });
  }

  protected onRowSelect(event: { data: Committee }): void {
    this.rowClick.emit(event.data);
  }

  protected sanitizeUrl(url: string | undefined): string | null {
    if (!url) return null;
    try {
      const parsed = new URL(url);
      return ['http:', 'https:', 'mailto:'].includes(parsed.protocol) ? url : null;
    } catch {
      return null;
    }
  }

  private performDelete(committee: Committee): void {
    this.isDeleting.set(true);

    this.committeeService.deleteCommittee(committee.uid).subscribe({
      next: () => {
        this.isDeleting.set(false);
        this.messageService.add({
          severity: 'success',
          summary: 'Success',
          detail: `${this.committeeLabel} deleted successfully`,
        });
        this.refresh.emit();
      },
      error: () => {
        this.isDeleting.set(false);
        this.messageService.add({
          severity: 'error',
          summary: 'Error',
          detail: `Failed to delete ${this.committeeLabel.toLowerCase()}`,
        });
      },
    });
  }
}
