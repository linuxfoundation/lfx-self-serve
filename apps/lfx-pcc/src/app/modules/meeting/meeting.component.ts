// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { HttpParams } from '@angular/common/http';
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
import { combineLatest, finalize, map, of, switchMap, tap } from 'rxjs';

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
  public project: WritableSignal<Project | null> = signal<Project | null>(null);
  public meeting: Signal<Meeting & { project: Project }>;
  public meetingTypeBadge: Signal<{ badgeClass: string; icon?: string; text: string } | null>;
  public importantLinks: Signal<{ url: string; domain: string }[]>;
  public returnTo: Signal<string | undefined>;
  public password: WritableSignal<string | null> = signal<string | null>(null);
  public canJoinMeeting: Signal<boolean>;
  public joinUrlWithParams: Signal<string | undefined>;

  // Form value signals for reactivity
  private formValues: Signal<{ name: string; email: string; organization: string }>;

  public constructor() {
    // Initialize all class variables
    this.isJoining = signal<boolean>(false);
    this.authenticated = this.userService.authenticated;
    this.meeting = this.initializeMeeting();
    this.joinForm = this.initializeJoinForm();
    this.formValues = this.initializeFormValues();
    this.meetingTypeBadge = this.initializeMeetingTypeBadge();
    this.importantLinks = this.initializeImportantLinks();
    this.returnTo = this.initializeReturnTo();
    this.canJoinMeeting = this.initializeCanJoinMeeting();
    this.joinUrlWithParams = this.initializeJoinUrlWithParams();
  }

  public onJoinMeeting(): void {
    if (!this.canJoinMeeting()) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Meeting Not Available',
        detail: 'The meeting has not started yet.',
      });
      return;
    }

    this.isJoining.set(true);

    this.meetingService
      .getPublicMeetingJoinUrl(this.meeting().uid, this.meeting().password, {
        email: this.authenticated() ? this.user()?.email : this.joinForm.get('email')?.value,
      })
      .pipe(finalize(() => this.isJoining.set(false)))
      .subscribe({
        next: (res) => {
          this.meeting().join_url = res.join_url;
          const joinUrlWithParams = this.buildJoinUrlWithParams(res.join_url);
          window.open(joinUrlWithParams, '_blank');
        },
        error: ({ error }) => {
          this.messageService.add({ severity: 'error', summary: 'Error', detail: error.error });
        },
      });
  }

  private initializeMeeting() {
    return toSignal<Meeting & { project: Project }>(
      combineLatest([this.activatedRoute.paramMap, this.activatedRoute.queryParamMap]).pipe(
        switchMap(([params, queryParams]) => {
          const meetingId = params.get('id');
          this.password.set(queryParams.get('password'));
          if (meetingId) {
            return this.meetingService.getPublicMeeting(meetingId, this.password());
          }

          // TODO: If no meeting ID, redirect to 404
          return of({} as { meeting: Meeting; project: Project });
        }),
        map((res) => ({ ...res.meeting, project: res.project })),
        tap((res) => {
          this.project.set(res.project);
        })
      )
    ) as Signal<Meeting & { project: Project }>;
  }

  // Private initialization methods
  private initializeJoinForm(): FormGroup {
    return new FormGroup({
      name: new FormControl<string>(this.user()?.name || '', [Validators.required]),
      email: new FormControl<string>(this.user()?.email || '', [Validators.required, Validators.email]),
      organization: new FormControl<string>(''),
    });
  }

  private initializeFormValues(): Signal<{ name: string; email: string; organization: string }> {
    return toSignal(
      this.joinForm.valueChanges.pipe(
        map(() => ({
          name: this.joinForm.get('name')?.value || '',
          email: this.joinForm.get('email')?.value || '',
          organization: this.joinForm.get('organization')?.value || '',
        }))
      ),
      {
        initialValue: {
          name: this.joinForm.get('name')?.value || '',
          email: this.joinForm.get('email')?.value || '',
          organization: this.joinForm.get('organization')?.value || '',
        },
      }
    );
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
      return `${environment.urls.home}/meetings/${this.meeting().uid}?password=${this.password()}`;
    });
  }

  private initializeCanJoinMeeting(): Signal<boolean> {
    return computed(() => {
      const meeting = this.meeting();
      if (!meeting?.start_time) {
        return false;
      }

      const now = new Date();
      const startTime = new Date(meeting.start_time);
      const earlyJoinMinutes = meeting.early_join_time_minutes || 10; // Default to 10 minutes
      const earliestJoinTime = new Date(startTime.getTime() - earlyJoinMinutes * 60000);

      return now >= earliestJoinTime;
    });
  }

  private initializeJoinUrlWithParams(): Signal<string | undefined> {
    return computed(() => {
      const meeting = this.meeting();
      const joinUrl = meeting?.join_url;

      if (!joinUrl) {
        return undefined;
      }

      // Access form values to trigger reactivity
      const formValues = this.formValues();
      return this.buildJoinUrlWithParams(joinUrl, formValues);
    });
  }

  private buildJoinUrlWithParams(joinUrl: string, formValues?: { name: string; email: string; organization: string }): string {
    if (!joinUrl) {
      return joinUrl;
    }

    // Get user name from authenticated user or form
    const userName = this.authenticated() ? this.user()?.name : formValues?.name || this.joinForm.get('name')?.value;
    const organization = this.authenticated() ? '' : formValues?.organization || this.joinForm.get('organization')?.value;

    if (!userName) {
      return joinUrl;
    }

    // Build the display name with organization if available
    const displayName = organization ? `${userName} (${organization})` : userName;

    // Create base64 encoded version
    const encodedName = btoa(unescape(encodeURIComponent(displayName)));

    // Build query parameters
    const queryParams = new HttpParams().set('uname', displayName).set('un', encodedName);
    const queryString = queryParams.toString();

    // Append to URL, handling existing query strings
    if (joinUrl.includes('?')) {
      return `${joinUrl}&${queryString}`;
    }
    return `${joinUrl}?${queryString}`;
  }
}
