// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT
// Generated with Claude Code

import { CommonModule } from '@angular/common';
import { Component, computed, inject, Signal, signal, WritableSignal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MeetingService } from '@app/shared/services/meeting.service';
import { MeetingParticipant } from '@lfx-pcc/shared';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { startWith, Subject, switchMap } from 'rxjs';

import { AddParticipantFormComponent } from '../add-participant-form/add-participant-form.component';
import { ButtonComponent } from '../button/button.component';
import { CardComponent } from '../card/card.component';
import { InplaceComponent } from '../inplace/inplace.component';
import { ParticipantListComponent } from '../participant-list/participant-list.component';

@Component({
  selector: 'lfx-participant-management-modal',
  standalone: true,
  imports: [CommonModule, CardComponent, ParticipantListComponent, AddParticipantFormComponent, ButtonComponent, InplaceComponent],
  templateUrl: './participant-management-modal.component.html',
  styleUrl: './participant-management-modal.component.scss',
})
export class ParticipantManagementModalComponent {
  // Injected services
  private readonly ref = inject(DynamicDialogRef);
  private readonly config = inject(DynamicDialogConfig);
  private readonly meetingService = inject(MeetingService);

  // Class variables with explicit types
  public meetingId: string;
  private refreshTrigger: Subject<void>;
  public participants: Signal<MeetingParticipant[] | undefined>;
  public loading: Signal<boolean>;
  public addParticipantActive: WritableSignal<boolean>;
  private participantsModified: boolean;

  public constructor() {
    this.meetingId = this.config.data.meetingId;
    this.addParticipantActive = signal(this.config.data.addParticipant ?? false);
    this.participantsModified = false;
    this.refreshTrigger = new Subject<void>();

    // Set up participants signal with refresh capability
    this.participants = toSignal(
      this.refreshTrigger.pipe(
        startWith(undefined),
        switchMap(() => this.meetingService.getMeetingParticipants(this.meetingId))
      ),
      { initialValue: [] }
    );

    // Loading state based on whether we have participants
    this.loading = computed(() => this.participants() === undefined);
  }

  // Public methods
  public onParticipantAdded(): void {
    this.participantsModified = true;
    // Trigger a refresh to get the updated list
    this.refreshTrigger.next();
  }

  public onParticipantDeleted(): void {
    this.participantsModified = true;
    // Trigger a refresh to get the updated list
    this.refreshTrigger.next();
  }

  public onClose(): void {
    this.ref.close({ participantsModified: this.participantsModified });
  }

  public onToggleAddParticipant(): void {
    this.addParticipantActive.set(!this.addParticipantActive());
  }
}
