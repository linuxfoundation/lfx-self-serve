// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DatePipe } from '@angular/common';
import { Component, inject, input, output, signal, WritableSignal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { TableComponent } from '@components/table/table.component';
import { TagComponent } from '@components/tag/tag.component';
import { Committee, COMMITTEE_CATEGORY_SEVERITY, COMMITTEE_LABEL, TagSeverity } from '@lfx-one/shared';
import { CommitteeService } from '@services/committee.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { DialogService, DynamicDialogModule, DynamicDialogRef } from 'primeng/dynamicdialog';
import { TooltipModule } from 'primeng/tooltip';
import { take } from 'rxjs';

import { MemberFormComponent } from '../member-form/member-form.component';

@Component({
  selector: 'lfx-committee-table',
  imports: [DatePipe, RouterLink, CardComponent, ButtonComponent, TableComponent, TagComponent, TooltipModule, ConfirmDialogModule, DynamicDialogModule],
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

  // Inputs
  public committees = input.required<Committee[]>();
  public canManageCommittee = input<boolean>(false);
  public committeeLabel = input<string>(COMMITTEE_LABEL.singular);

  // State
  public isDeleting: WritableSignal<boolean> = signal<boolean>(false);

  // Outputs
  public readonly refresh = output<void>();

  // Helper method for category severity
  public getCategorySeverity(category: string): TagSeverity {
    return COMMITTEE_CATEGORY_SEVERITY[category] || 'secondary';
  }

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
      message: `Are you sure you want to delete the ${this.committeeLabel().toLowerCase()} "${committee.name}"? This action cannot be undone.`,
      header: `Delete ${this.committeeLabel()}`,
      acceptLabel: 'Delete',
      rejectLabel: 'Cancel',
      acceptButtonStyleClass: 'p-button-danger p-button-sm',
      rejectButtonStyleClass: 'p-button-outlined p-button-sm',
      accept: () => this.performDelete(committee),
    });
  }

  private performDelete(committee: Committee): void {
    this.isDeleting.set(true);

    this.committeeService.deleteCommittee(committee.uid).subscribe({
      next: () => {
        this.isDeleting.set(false);
        this.messageService.add({
          severity: 'success',
          summary: 'Success',
          detail: `${this.committeeLabel()} deleted successfully`,
        });
        this.refresh.emit();
      },
      error: (error) => {
        this.isDeleting.set(false);
        this.messageService.add({
          severity: 'error',
          summary: 'Error',
          detail: `Failed to delete ${this.committeeLabel().toLowerCase()}`,
        });
        console.error(`Failed to delete ${this.committeeLabel().toLowerCase()}:`, error);
      },
    });
  }
}
