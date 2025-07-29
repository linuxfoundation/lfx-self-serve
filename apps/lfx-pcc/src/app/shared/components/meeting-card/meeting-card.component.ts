// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, computed, inject, Injector, input, output, runInInjectionContext, signal, Signal, WritableSignal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { BadgeComponent } from '@app/shared/components/badge/badge.component';
import { ButtonComponent } from '@app/shared/components/button/button.component';
import { MenuComponent } from '@app/shared/components/menu/menu.component';
import { ParticipantManagementModalComponent } from '@app/shared/components/participant-management-modal/participant-management-modal.component';
import { MeetingTimePipe } from '@app/shared/pipes/meeting-time.pipe';
import { CommitteeService } from '@app/shared/services/committee.service';
import { MeetingService } from '@app/shared/services/meeting.service';
import { ProjectService } from '@app/shared/services/project.service';
import { Meeting, MeetingParticipant } from '@lfx-pcc/shared/interfaces';
import { AnimateOnScrollModule } from 'primeng/animateonscroll';
import { MenuItem } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { TooltipModule } from 'primeng/tooltip';
import { catchError, combineLatest, finalize, map, of, take } from 'rxjs';

import { AvatarComponent } from '../avatar/avatar.component';

@Component({
  selector: 'lfx-meeting-card',
  standalone: true,
  imports: [CommonModule, RouterLink, ButtonComponent, MenuComponent, BadgeComponent, MeetingTimePipe, AvatarComponent, TooltipModule, AnimateOnScrollModule],
  templateUrl: './meeting-card.component.html',
  styleUrl: './meeting-card.component.scss',
})
export class MeetingCardComponent {
  private readonly projectService = inject(ProjectService);
  private readonly meetingService = inject(MeetingService);
  private readonly committeeService = inject(CommitteeService);
  private readonly dialogService = inject(DialogService);
  private readonly injector = inject(Injector);

  public readonly meeting = input.required<Meeting>();
  public readonly actionMenuItems = input.required<MenuItem[]>();
  public readonly pastMeeting = input<boolean>(false);
  public readonly loading = input<boolean>(false);
  public readonly meetingParticipantCount: Signal<number> = this.initMeetingParticipantCount();
  public showParticipants: WritableSignal<boolean> = signal(false);
  public participantsLoading: WritableSignal<boolean> = signal(true);
  public participants!: Signal<MeetingParticipant[]>;
  public participantsLabel: Signal<string> = this.initParticipantsLabel();

  public readonly menuToggle = output<{ event: Event; meeting: Meeting; menuComponent: MenuComponent }>();
  public readonly participantsModified = output<void>();
  public readonly project = this.projectService.project;

  public onMenuToggle(event: Event, menuComponent: MenuComponent): void {
    event.stopPropagation();
    this.menuToggle.emit({ event, meeting: this.meeting(), menuComponent });
  }

  public onParticipantsToggle(event: Event): void {
    event.stopPropagation();

    if (this.meetingParticipantCount() === 0) {
      // Open participant management modal for adding participants
      this.dialogService
        .open(ParticipantManagementModalComponent, {
          header: 'Manage Participants',
          width: '700px',
          modal: true,
          closable: false,
          dismissableMask: true,
          data: {
            meetingId: this.meeting().id,
            addParticipant: true,
          },
        })
        .onClose.pipe(take(1))
        .subscribe((result) => {
          if (result?.participantsModified) {
            this.participantsModified.emit();
          }
        });
      return;
    }

    // Show/hide inline participants display
    this.participantsLoading.set(true);
    if (!this.showParticipants()) {
      const queries = combineLatest([
        this.meetingService.getMeetingParticipants(this.meeting().id),
        ...(this.meeting().committees?.map((c) => this.committeeService.getCommitteeMembers(c).pipe(catchError(() => of([])))) ?? []),
      ]).pipe(
        map(([participants, ...committeeMembers]) => {
          return [
            ...participants,
            ...committeeMembers
              .filter((c) => c.length > 0)
              .flatMap((c) => {
                return c.map((m) => ({
                  id: m.id,
                  meeting_id: this.meeting().id,
                  first_name: m.first_name,
                  last_name: m.last_name,
                  email: m.email,
                  organization: m.organization,
                  is_host: false,
                  type: 'committee',
                  invite_accepted: true,
                  attended: true,
                }));
              }),
          ];
        }),
        // Sort participants by first name
        map((participants) => participants.sort((a, b) => a.first_name?.localeCompare(b.first_name ?? '') ?? 0) as MeetingParticipant[]),
        finalize(() => this.participantsLoading.set(false))
      );

      runInInjectionContext(this.injector, () => {
        this.participants = toSignal(queries, {
          initialValue: [],
        });
      });
    }

    this.showParticipants.set(!this.showParticipants());
  }

  private initMeetingParticipantCount(): Signal<number> {
    return computed(() => this.meeting().individual_participants_count + this.meeting().committee_members_count);
  }

  private initParticipantsLabel(): Signal<string> {
    return computed(() => {
      if (this.meetingParticipantCount() === 0) {
        return 'Add Guests';
      }

      if (this.meetingParticipantCount() === 1) {
        return '1 Guest';
      }

      return this.meetingParticipantCount() + ' Guests';
    });
  }
}
