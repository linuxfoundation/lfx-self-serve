// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, effect, inject, input, InputSignal, output, OutputEmitterRef, Signal, signal, WritableSignal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { AvatarComponent } from '@components/avatar/avatar.component';
import { Meeting, MeetingRegistrant, PastMeeting, PastMeetingParticipant } from '@lfx-one/shared';
import { RegistrantModalComponent } from '@modules/project/meetings/components/registrant-modal/registrant-modal.component';
import { MeetingService } from '@services/meeting.service';
import { DialogService } from 'primeng/dynamicdialog';
import { TooltipModule } from 'primeng/tooltip';
import { BehaviorSubject, catchError, filter, finalize, map, of, switchMap, take, tap } from 'rxjs';

@Component({
  selector: 'lfx-meeting-registrants',
  standalone: true,
  imports: [CommonModule, AvatarComponent, TooltipModule],
  templateUrl: './meeting-registrants.component.html',
})
export class MeetingRegistrantsComponent {
  private readonly meetingService = inject(MeetingService);
  private readonly dialogService = inject(DialogService);

  public readonly meeting: InputSignal<Meeting | PastMeeting> = input.required<Meeting | PastMeeting>();
  public readonly pastMeeting: InputSignal<boolean> = input<boolean>(false);
  public readonly visible: InputSignal<boolean> = input<boolean>(false);
  public readonly showAddRegistrant: InputSignal<boolean> = input<boolean>(false);

  public readonly registrantsCountChange: OutputEmitterRef<number> = output<number>();

  public readonly registrantsLoading: WritableSignal<boolean> = signal(true);
  private readonly refresh$: BehaviorSubject<boolean> = new BehaviorSubject<boolean>(false);
  public readonly registrants: Signal<MeetingRegistrant[]> = this.initRegistrantsList();
  public readonly pastMeetingParticipants: Signal<PastMeetingParticipant[]> = this.initPastMeetingParticipantsList();
  public readonly additionalRegistrantsCount: WritableSignal<number> = signal(0);

  public constructor() {
    effect(() => {
      if (this.visible()) {
        this.registrantsLoading.set(true);
        this.refresh$.next(true);
      }
    });
  }

  public onAddRegistrantClick(): void {
    const dialogRef = this.dialogService.open(RegistrantModalComponent, {
      header: 'Add Guests',
      width: '650px',
      modal: true,
      closable: true,
      dismissableMask: true,
      data: {
        meetingId: this.meeting().uid,
        registrant: null,
      },
    });

    dialogRef.onChildComponentLoaded.pipe(take(1)).subscribe((component) => {
      component.registrantSaved.subscribe(() => {
        this.refresh();
      });
    });
  }

  public onRegistrantEdit(registrant: MeetingRegistrant): void {
    this.dialogService
      .open(RegistrantModalComponent, {
        header: registrant.type === 'committee' ? 'Committee Member' : 'Edit Guest',
        width: '650px',
        modal: true,
        closable: true,
        dismissableMask: true,
        data: {
          meetingId: this.meeting().uid,
          registrant: registrant,
          isCommitteeMember: registrant.type === 'committee',
        },
      })
      .onClose.pipe(take(1))
      .subscribe((result) => {
        if (result) {
          this.refresh();
        }
      });
  }

  public refresh(): void {
    this.refresh$.next(true);
  }

  private initRegistrantsList(): Signal<MeetingRegistrant[]> {
    return toSignal(
      this.refresh$.pipe(
        takeUntilDestroyed(),
        filter((refresh) => refresh && !this.pastMeeting()),
        switchMap(() => {
          this.registrantsLoading.set(true);
          return this.meetingService
            .getMeetingRegistrants(this.meeting().uid)
            .pipe(catchError(() => of([])))
            .pipe(
              map((registrants) => registrants.sort((a, b) => a.first_name?.localeCompare(b.first_name ?? '') ?? 0) as MeetingRegistrant[]),
              tap((registrants) => {
                const baseCount = (this.meeting().individual_registrants_count || 0) + (this.meeting().committee_members_count || 0);
                const additionalCount = Math.max(0, (registrants?.length || 0) - baseCount);
                this.additionalRegistrantsCount.set(additionalCount);
                this.registrantsCountChange.emit(additionalCount);
              }),
              finalize(() => this.registrantsLoading.set(false))
            );
        })
      ),
      { initialValue: [] }
    );
  }

  private initPastMeetingParticipantsList(): Signal<PastMeetingParticipant[]> {
    return toSignal(
      this.refresh$.pipe(
        takeUntilDestroyed(),
        filter((refresh) => refresh && this.pastMeeting()),
        switchMap(() => {
          this.registrantsLoading.set(true);
          return this.meetingService
            .getPastMeetingParticipants(this.meeting().uid)
            .pipe(catchError(() => of([])))
            .pipe(
              map((participants) => participants.sort((a, b) => a.first_name?.localeCompare(b.first_name ?? '') ?? 0) as PastMeetingParticipant[]),
              finalize(() => this.registrantsLoading.set(false))
            );
        })
      ),
      { initialValue: [] }
    );
  }
}
