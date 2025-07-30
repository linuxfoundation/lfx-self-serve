// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT
// Generated with Claude Code

import { CommonModule } from '@angular/common';
import { Component, inject, input, output, signal, WritableSignal } from '@angular/core';
import { ButtonComponent } from '@components/button/button.component';
import { TableComponent } from '@components/table/table.component';
import { MeetingParticipant } from '@lfx-pcc/shared/interfaces';
import { MeetingService } from '@services/meeting.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';

@Component({
  selector: 'lfx-participant-list',
  standalone: true,
  imports: [CommonModule, TableComponent, ButtonComponent, ConfirmDialogModule],
  templateUrl: './participant-list.component.html',
  styleUrl: './participant-list.component.scss',
  providers: [ConfirmationService],
})
export class ParticipantListComponent {
  // Injected services
  private readonly meetingService = inject(MeetingService);
  private readonly messageService = inject(MessageService);
  private readonly confirmationService = inject(ConfirmationService);

  // Inputs
  public readonly participants = input.required<MeetingParticipant[]>();
  public readonly meetingId = input.required<string>();

  // Outputs
  public readonly participantDeleted = output<string>();

  // Class variables with explicit types
  public deletingParticipantIds: WritableSignal<Set<string>>;

  public constructor() {
    this.deletingParticipantIds = signal<Set<string>>(new Set());
  }

  // Public methods
  public confirmDelete(participant: MeetingParticipant): void {
    this.confirmationService.confirm({
      message: `Are you sure you want to remove ${participant.first_name} ${participant.last_name} from this meeting?`,
      header: 'Confirm Removal',
      icon: 'fa-light fa-triangle-exclamation',
      acceptLabel: 'Remove',
      rejectLabel: 'Cancel',
      acceptIcon: 'fa-light fa-trash',
      acceptButtonStyleClass: 'p-button-danger p-button-sm',
      rejectButtonStyleClass: 'p-button-secondary p-button-sm',
      accept: () => {
        this.deleteParticipant(participant);
      },
    });
  }

  public isDeleting(participantId: string): boolean {
    return this.deletingParticipantIds().has(participantId);
  }

  // Private methods
  private deleteParticipant(participant: MeetingParticipant): void {
    this.deletingParticipantIds.update((ids) => {
      const newIds = new Set(ids);
      newIds.add(participant.id);
      return newIds;
    });

    this.meetingService.deleteMeetingParticipant(this.meetingId(), participant.id).subscribe({
      next: () => {
        this.deletingParticipantIds.update((ids) => {
          const newIds = new Set(ids);
          newIds.delete(participant.id);
          return newIds;
        });
        this.messageService.add({
          severity: 'success',
          summary: 'Success',
          detail: 'Participant removed successfully',
        });
        this.participantDeleted.emit(participant.id);
      },
      error: (error) => {
        this.deletingParticipantIds.update((ids) => {
          const newIds = new Set(ids);
          newIds.delete(participant.id);
          return newIds;
        });
        console.error('Failed to delete participant:', error);
        this.messageService.add({
          severity: 'error',
          summary: 'Error',
          detail: error?.error?.message || 'Failed to remove participant',
        });
      },
    });
  }
}
