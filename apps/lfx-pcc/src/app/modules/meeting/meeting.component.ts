// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal, Signal, WritableSignal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { LinkifyPipe } from '@app/shared/pipes/linkify.pipe';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { ExpandableTextComponent } from '@components/expandable-text/expandable-text.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { environment } from '@environments/environment';
import { extractUrlsWithDomains, Meeting, Project, User } from '@lfx-pcc/shared';
import { MeetingTimePipe } from '@pipes/meeting-time.pipe';
import { MeetingService } from '@services/meeting.service';
import { UserService } from '@services/user.service';
import { MessageService } from 'primeng/api';
import { ToastModule } from 'primeng/toast';
import { TooltipModule } from 'primeng/tooltip';
import { combineLatest, map, of, switchMap } from 'rxjs';

@Component({
  selector: 'lfx-meeting',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ButtonComponent,
    CardComponent,
    InputTextComponent,
    ToastModule,
    TooltipModule,
    MeetingTimePipe,
    LinkifyPipe,
    ExpandableTextComponent,
  ],
  providers: [MessageService],
  templateUrl: './meeting.component.html',
})
export class MeetingComponent {
  // Injected services
  private readonly messageService = inject(MessageService);
  private readonly activatedRoute = inject(ActivatedRoute);
  private readonly meetingService = inject(MeetingService);
  private readonly userService = inject(UserService);

  // Class variables with types
  public isJoining: WritableSignal<boolean>;
  public authenticated: WritableSignal<boolean>;
  public user: Signal<User | null> = this.userService.user;
  public joinForm: FormGroup;
  public project: Signal<Project | null> = signal<Project | null>(null);
  public meeting: Signal<Meeting & { project: Project }>;
  public meetingTypeBadge: Signal<{ badgeClass: string; icon?: string; text: string } | null>;
  public importantLinks: Signal<{ url: string; domain: string }[]>;
  public returnTo: Signal<string | undefined>;

  public constructor() {
    // Initialize all class variables
    this.isJoining = signal<boolean>(false);
    this.authenticated = this.userService.authenticated;
    this.meeting = this.initializeMeeting();
    this.joinForm = this.initializeJoinForm();
    this.meetingTypeBadge = this.initializeMeetingTypeBadge();
    this.importantLinks = this.initializeImportantLinks();
    this.returnTo = this.initializeReturnTo();
  }

  private initializeMeeting() {
    return toSignal<Meeting & { project: Project }>(
      combineLatest([this.activatedRoute.paramMap, this.activatedRoute.queryParamMap]).pipe(
        switchMap(([params]) => {
          const meetingId = params.get('id');
          if (meetingId) {
            return this.meetingService.getPublicMeeting(meetingId);
          }

          // TODO: If no meeting ID, redirect to 404
          return of({} as { meeting: Meeting; project: Project });
        }),
        map((res) => ({ ...res.meeting, project: res.project }))
      )
    ) as Signal<Meeting & { project: Project }>;
  }

  // Private initialization methods
  private initializeJoinForm(): FormGroup {
    return new FormGroup({
      fullName: new FormControl<string>('', [Validators.required]),
      email: new FormControl<string>('', [Validators.required, Validators.email]),
      organization: new FormControl<string>(''),
    });
  }

  private initializeMeetingTypeBadge(): Signal<{ badgeClass: string; icon?: string; text: string } | null> {
    return computed(() => {
      const meetingType = this.meeting()?.meeting_type || 'none';
      const normalizedType = meetingType.toLowerCase();

      switch (normalizedType) {
        case 'board':
          return {
            badgeClass: 'bg-meeting-board text-white',
            icon: 'fa-light fa-user-check',
            text: 'Board',
          };
        case 'maintainers':
          return {
            badgeClass: 'bg-meeting-maintainers text-white',
            icon: 'fa-light fa-cog',
            text: 'Maintainers',
          };
        case 'marketing':
          return {
            badgeClass: 'bg-meeting-marketing text-white',
            icon: 'fa-light fa-chart-line',
            text: 'Marketing',
          };
        case 'technical':
          return {
            badgeClass: 'bg-meeting-technical text-white',
            icon: 'fa-light fa-code',
            text: 'Technical',
          };
        case 'legal':
          return {
            badgeClass: 'bg-meeting-legal text-white',
            icon: 'fa-light fa-balance-scale',
            text: 'Legal',
          };
        case 'other':
          return {
            badgeClass: 'bg-meeting-other text-white',
            icon: 'fa-light fa-folder',
            text: 'Other',
          };
        default:
          return null;
      }
    });
  }

  private initializeImportantLinks(): Signal<{ url: string; domain: string }[]> {
    return computed(() => {
      const meeting = this.meeting();
      if (!meeting?.description) {
        return [];
      }
      return extractUrlsWithDomains(meeting.description);
    });
  }

  private initializeReturnTo(): Signal<string | undefined> {
    return computed(() => {
      return `${environment.urls.home}/meetings/${this.meeting().uid}`;
    });
  }
}
