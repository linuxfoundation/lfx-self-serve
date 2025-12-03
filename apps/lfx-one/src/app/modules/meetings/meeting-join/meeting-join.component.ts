// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Clipboard, ClipboardModule } from '@angular/cdk/clipboard';
import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal, Signal, WritableSignal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MeetingRegistrantsDisplayComponent } from '@app/modules/meetings/components/meeting-registrants-display/meeting-registrants-display.component';
import { RsvpButtonGroupComponent } from '@app/modules/meetings/components/rsvp-button-group/rsvp-button-group.component';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { ExpandableTextComponent } from '@components/expandable-text/expandable-text.component';
import { HeaderComponent } from '@components/header/header.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { TagComponent } from '@components/tag/tag.component';
import { environment } from '@environments/environment';
import {
  buildJoinUrlWithParams,
  canJoinMeeting,
  ComponentSeverity,
  getCurrentOrNextOccurrence,
  getEarlyJoinTimeMinutes,
  Meeting,
  MeetingAttachment,
  MeetingOccurrence,
  Project,
  User,
} from '@lfx-one/shared';
import { FileTypeIconPipe } from '@pipes/file-type-icon.pipe';
import { LinkifyPipe } from '@pipes/linkify.pipe';
import { MeetingTimePipe } from '@pipes/meeting-time.pipe';
import { RecurrenceSummaryPipe } from '@pipes/recurrence-summary.pipe';
import { MeetingService } from '@services/meeting.service';
import { UserService } from '@services/user.service';
import { MessageService } from 'primeng/api';
import { ToastModule } from 'primeng/toast';
import { TooltipModule } from 'primeng/tooltip';
import { catchError, combineLatest, debounceTime, filter, map, Observable, of, startWith, switchMap, take, tap } from 'rxjs';

import { MeetingRsvpDetailsComponent } from '../components/meeting-rsvp-details/meeting-rsvp-details.component';

@Component({
  selector: 'lfx-meeting-join',
  standalone: true,
  imports: [
    ClipboardModule,
    CommonModule,
    ReactiveFormsModule,
    ButtonComponent,
    CardComponent,
    InputTextComponent,
    TagComponent,
    RsvpButtonGroupComponent,
    MeetingRsvpDetailsComponent,
    MeetingRegistrantsDisplayComponent,
    ToastModule,
    TooltipModule,
    MeetingTimePipe,
    RecurrenceSummaryPipe,
    LinkifyPipe,
    FileTypeIconPipe,
    ExpandableTextComponent,
    HeaderComponent,
  ],
  providers: [],
  templateUrl: './meeting-join.component.html',
})
export class MeetingJoinComponent {
  // Injected services
  private readonly messageService = inject(MessageService);
  private readonly activatedRoute = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly meetingService = inject(MeetingService);
  private readonly userService = inject(UserService);
  private readonly clipboard = inject(Clipboard);

  // Class variables with types
  public authenticated: WritableSignal<boolean>;
  public user: Signal<User | null> = this.userService.user;
  public joinForm: FormGroup;
  public project: WritableSignal<Project | null> = signal<Project | null>(null);
  public meeting: Signal<Meeting & { project: Project }>;
  public currentOccurrence: Signal<MeetingOccurrence | null>;
  public meetingTypeBadge: Signal<{
    badgeClass: string;
    severity: ComponentSeverity;
    icon?: string;
    text: string;
  } | null>;
  public returnTo: Signal<string | undefined>;
  public password: WritableSignal<string | null> = signal<string | null>(null);
  public canJoinMeeting: Signal<boolean>;
  public fetchedJoinUrl: Signal<string | undefined>;
  public isLoadingJoinUrl: WritableSignal<boolean> = signal<boolean>(false);
  public joinUrlError: WritableSignal<string | null> = signal<string | null>(null);
  public attachments: Signal<MeetingAttachment[]>;
  public messageSeverity: Signal<'success' | 'info' | 'warn'>;
  public messageIcon: Signal<string>;
  public alertMessage: Signal<string>;
  private hasAutoJoined: WritableSignal<boolean> = signal<boolean>(false);
  public showRegistrants: WritableSignal<boolean> = signal<boolean>(false);

  // TODO(v1-migration): Remove V1/V2 fallback fields once all meetings are migrated to V2
  // V1/V2 fallback fields
  public meetingTitle: Signal<string>;
  public meetingDescription: Signal<string>;
  public hasAiCompanion: Signal<boolean>;
  public isLegacyMeeting: Signal<boolean>;
  public meetingIdentifier: Signal<string>;

  // Form value signals for reactivity
  public formValues: Signal<{ name: string; email: string; organization: string }>;

  public constructor() {
    // Initialize all class variables
    this.authenticated = this.userService.authenticated;
    this.meeting = this.initializeMeeting();
    this.currentOccurrence = this.initializeCurrentOccurrence();
    this.joinForm = this.initializeJoinForm();
    this.formValues = this.initializeFormValues();
    this.meetingTypeBadge = this.initializeMeetingTypeBadge();

    // TODO(v1-migration): Remove V1/V2 fallback field initialization once all meetings are migrated to V2
    // V1/V2 fallback fields - must be initialized before returnTo and attachments
    this.meetingTitle = this.initializeMeetingTitle();
    this.meetingDescription = this.initializeMeetingDescription();
    this.hasAiCompanion = this.initializeHasAiCompanion();
    this.isLegacyMeeting = this.initializeIsLegacyMeeting();
    this.meetingIdentifier = this.initializeMeetingIdentifier();

    this.returnTo = this.initializeReturnTo();
    this.canJoinMeeting = this.initializeCanJoinMeeting();
    this.fetchedJoinUrl = this.initializeFetchedJoinUrl();
    this.attachments = this.initializeAttachments();
    this.messageSeverity = this.initializeMessageSeverity();
    this.messageIcon = this.initializeMessageIcon();
    this.alertMessage = this.initializeAlertMessage();
    this.initializeAutoJoin();
  }

  public handleCopyLink(): void {
    const meeting = this.meeting();
    const identifier = this.meetingIdentifier();
    const meetingUrl: URL = new URL(environment.urls.home + '/meetings/' + identifier);

    if (meeting.password) {
      meetingUrl.searchParams.set('password', meeting.password);
    }
    if (this.isLegacyMeeting()) {
      meetingUrl.searchParams.set('v1', 'true');
    }

    this.clipboard.copy(meetingUrl.toString());
    this.messageService.add({
      severity: 'success',
      summary: 'Meeting Link Copied',
      detail: 'The meeting link has been copied to your clipboard',
    });
  }

  public onRegistrantsToggle(): void {
    this.showRegistrants.set(!this.showRegistrants());
  }

  private initializeAutoJoin(): void {
    // Use toObservable to create an Observable from the signals, then subscribe once
    // This executes only when all conditions are met
    toObservable(this.fetchedJoinUrl)
      .pipe(
        // Take only the first emission where we have a valid URL and haven't auto-joined yet
        filter((url) => {
          const authenticated = this.authenticated();
          const user = this.user();
          const canJoin = this.canJoinMeeting();
          const alreadyJoined = this.hasAutoJoined();

          return !!url && authenticated && !!user && !!user.email && canJoin && !alreadyJoined;
        }),
        // Take only the first valid URL
        take(1)
      )
      .subscribe((url) => {
        // Mark as auto-joined to prevent multiple attempts
        this.hasAutoJoined.set(true);

        // Open the meeting URL in a new tab
        if (typeof window !== 'undefined' && url) {
          const newWindow = window.open(url, '_blank', 'noopener,noreferrer');

          // With noopener, window.open() may return null even on success
          // Only check if window.closed is explicitly true to detect popup blocking
          if (newWindow !== null && newWindow.closed) {
            // Popup was blocked
            this.messageService.add({
              severity: 'warn',
              summary: 'Popup Blocked',
              detail: 'Your browser blocked the meeting window. Please click the "Join Meeting" button to open it manually.',
              life: 5000,
            });
          } else {
            // Window opened (or likely opened with noopener returning null)
            this.messageService.add({
              severity: 'success',
              summary: 'Meeting Opened',
              detail: "The meeting has been opened in a new tab. If you don't see it, check if popups are blocked.",
              life: 3000,
            });
          }
        }
      });
  }

  private initializeMeeting() {
    return toSignal<Meeting & { project: Project }>(
      combineLatest([this.activatedRoute.paramMap, this.activatedRoute.queryParamMap]).pipe(
        switchMap(([params, queryParams]) => {
          const meetingId = params.get('id');
          this.password.set(queryParams.get('password'));
          if (meetingId) {
            return this.meetingService.getPublicMeeting(meetingId, this.password()).pipe(
              catchError((error) => {
                // If 404, navigate to not found page
                if ([404, 403, 400].includes(error.status)) {
                  this.router.navigate(['/meetings/not-found']);
                  return of({} as { meeting: Meeting; project: Project });
                }
                // Re-throw other errors
                throw error;
              })
            );
          }

          // If no meeting ID, redirect to not found
          this.router.navigate(['/meetings/not-found']);
          return of({} as { meeting: Meeting; project: Project });
        }),
        map((res) => ({ ...res.meeting, project: res.project })),
        tap((res) => {
          this.project.set(res.project);
        })
      )
    ) as Signal<Meeting & { project: Project }>;
  }

  private initializeCurrentOccurrence(): Signal<MeetingOccurrence | null> {
    return computed(() => {
      const meeting = this.meeting();
      return getCurrentOrNextOccurrence(meeting);
    });
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

  private initializeMeetingTypeBadge(): Signal<{
    badgeClass: string;
    severity: ComponentSeverity;
    icon?: string;
    text: string;
  } | null> {
    return computed(() => {
      const meetingType = this.meeting()?.meeting_type;
      if (!meetingType) return null;

      const type = meetingType.toLowerCase();

      switch (type) {
        case 'board':
          return { badgeClass: 'bg-red-100 text-red-500', severity: 'danger', icon: 'fa-light fa-user-check', text: meetingType };
        case 'maintainers':
          return { badgeClass: 'bg-blue-100 text-blue-500', severity: 'info', icon: 'fa-light fa-gear', text: meetingType };
        case 'marketing':
          return { badgeClass: 'bg-green-100 text-green-500', severity: 'success', icon: 'fa-light fa-chart-line-up', text: meetingType };
        case 'technical':
          return { badgeClass: 'bg-purple-100 text-purple-500', severity: 'primary', icon: 'fa-light fa-code', text: meetingType };
        case 'legal':
          return { badgeClass: 'bg-amber-100 text-amber-500', severity: 'warn', icon: 'fa-light fa-scale-balanced', text: meetingType };
        default:
          return { badgeClass: 'bg-gray-100 text-gray-400', severity: 'secondary', icon: 'fa-light fa-calendar-days', text: meetingType };
      }
    });
  }

  private initializeReturnTo(): Signal<string | undefined> {
    return computed(() => {
      const meeting = this.meeting();
      const identifier = this.meetingIdentifier();
      const params = new URLSearchParams();

      if (meeting.password) {
        params.set('password', meeting.password);
      }
      if (this.isLegacyMeeting()) {
        params.set('v1', 'true');
      }

      const queryString = params.toString();
      return queryString ? `${environment.urls.home}/meetings/${identifier}?${queryString}` : `${environment.urls.home}/meetings/${identifier}`;
    });
  }

  private initializeCanJoinMeeting(): Signal<boolean> {
    return computed(() => {
      return canJoinMeeting(this.meeting(), this.currentOccurrence());
    });
  }

  private initializeMessageSeverity(): Signal<'success' | 'info' | 'warn'> {
    return computed(() => {
      const canJoinMeeting = this.canJoinMeeting();

      if (canJoinMeeting) {
        return 'info';
      }
      return 'warn';
    });
  }

  private initializeMessageIcon(): Signal<string> {
    return computed(() => {
      const canJoinMeeting = this.canJoinMeeting();

      if (canJoinMeeting) {
        return 'fa-light fa-check-circle';
      }
      return 'fa-light fa-clock';
    });
  }

  private initializeFetchedJoinUrl(): Signal<string | undefined> {
    return toSignal(
      combineLatest([toObservable(this.canJoinMeeting), this.joinForm.statusChanges.pipe(debounceTime(300), startWith(this.joinForm.status))]).pipe(
        switchMap(([canJoin, formStatus]) => {
          const meeting = this.meeting();
          const authenticated = this.authenticated();
          const user = this.user();

          // Reset error state
          this.joinUrlError.set(null);

          // Only fetch when meeting is joinable and we have necessary user info
          if (!canJoin || (!meeting?.uid && !meeting?.id)) {
            this.isLoadingJoinUrl.set(false);
            return of(undefined);
          }

          // Determine email based on authentication status
          let email: string | undefined;

          if (authenticated) {
            // For authenticated users, use their email from user profile
            email = user?.email;
            if (!email) {
              this.isLoadingJoinUrl.set(false);
              return of(undefined);
            }
          } else {
            // For unauthenticated users, form must be valid
            if (formStatus !== 'VALID') {
              this.isLoadingJoinUrl.set(false);
              return of(undefined);
            }
            // Use email from form
            email = this.joinForm.get('email')?.value;
            if (!email) {
              this.isLoadingJoinUrl.set(false);
              return of(undefined);
            }
          }

          // Fetch join URL with the determined email
          return this.fetchJoinUrl(meeting, email);
        })
      ),
      { initialValue: undefined }
    );
  }

  private fetchJoinUrl(meeting: Meeting, email: string): Observable<string | undefined> {
    this.isLoadingJoinUrl.set(true);

    return this.meetingService.getPublicMeetingJoinUrl(this.meetingIdentifier(), meeting.password, { email }).pipe(
      map((res) => {
        this.isLoadingJoinUrl.set(false);
        if (res.join_url) {
          // For authenticated users, use the user object
          // For guests, pass name and organization from form
          if (this.authenticated()) {
            return buildJoinUrlWithParams(res.join_url, this.user());
          }

          return buildJoinUrlWithParams(res.join_url, null, {
            name: this.joinForm.get('name')?.value,
            organization: this.joinForm.get('organization')?.value,
          });
        }
        return undefined;
      }),
      catchError((error) => {
        this.isLoadingJoinUrl.set(false);
        this.joinUrlError.set(error?.error?.error || 'Failed to load meeting join URL. Please try again.');
        return of(undefined);
      })
    );
  }

  private initializeAttachments(): Signal<MeetingAttachment[]> {
    // Convert meeting signal to observable to react to changes
    return toSignal(
      toObservable(this.meetingIdentifier).pipe(
        switchMap((identifier) => {
          if (identifier) {
            return this.meetingService.getMeetingAttachments(identifier).pipe(
              catchError((error) => {
                console.error(`Failed to load attachments for meeting ${identifier}:`, error);
                return of([]);
              })
            );
          }
          return of([]);
        })
      ),
      { initialValue: [] }
    );
  }

  private initializeAlertMessage(): Signal<string> {
    return computed(() => {
      const canJoin = this.canJoinMeeting();
      const meeting = this.meeting();
      const earlyJoinMinutes = getEarlyJoinTimeMinutes(meeting) || 10;

      if (canJoin) {
        return 'The meeting is in progress.';
      }
      return `You may only join the meeting up to ${earlyJoinMinutes} minutes before the start time.`;
    });
  }

  // TODO(v1-migration): Simplify to use V2 fields only once all meetings are migrated to V2
  private initializeMeetingTitle(): Signal<string> {
    return computed(() => {
      const occurrence = this.currentOccurrence();
      const meeting = this.meeting();

      // Priority: occurrence title > meeting title > meeting topic (v1)
      return occurrence?.title || meeting?.title || meeting?.topic || '';
    });
  }

  // TODO(v1-migration): Simplify to use V2 fields only once all meetings are migrated to V2
  private initializeMeetingDescription(): Signal<string> {
    return computed(() => {
      const occurrence = this.currentOccurrence();
      const meeting = this.meeting();

      // Priority: occurrence description > meeting description > meeting agenda (v1)
      return occurrence?.description || meeting?.description || meeting?.agenda || '';
    });
  }

  // TODO(v1-migration): Simplify to use V2 fields only once all meetings are migrated to V2
  private initializeHasAiCompanion(): Signal<boolean> {
    return computed(() => {
      const meeting = this.meeting();

      // V2: zoom_config.ai_companion_enabled, V1: zoom_ai_enabled
      return meeting?.zoom_config?.ai_companion_enabled || meeting?.zoom_ai_enabled || false;
    });
  }

  // TODO(v1-migration): Remove once all meetings are migrated to V2
  private initializeIsLegacyMeeting(): Signal<boolean> {
    return computed(() => this.meeting()?.version === 'v1');
  }

  // TODO(v1-migration): Simplify to use V2 uid only once all meetings are migrated to V2
  private initializeMeetingIdentifier(): Signal<string> {
    return computed(() => {
      const meeting = this.meeting();
      return this.isLegacyMeeting() && meeting?.id ? (meeting.id as string) : meeting?.uid;
    });
  }
}
