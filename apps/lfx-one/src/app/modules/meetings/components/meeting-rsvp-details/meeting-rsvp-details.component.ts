// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { Component, computed, inject, input, InputSignal, output, signal, Signal, WritableSignal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { MeetingAttendeePreviewComponent } from '@app/modules/meetings/components/meeting-attendee-preview/meeting-attendee-preview.component';
import { ButtonComponent } from '@components/button/button.component';
import {
  calculateRsvpCounts,
  countRegistrantAttendance,
  Meeting,
  MeetingAttendeePreviewPerson,
  MeetingOccurrence,
  MeetingRegistrant,
  MeetingRsvp,
  PastMeeting,
  PastMeetingParticipant,
  Project,
  RsvpCounts,
} from '@lfx-one/shared';
import {
  buildAttendeePreviewFromRegistrants,
  buildAttendeePreviewFromRsvps,
  getCurrentOrNextOccurrence,
  isMeetingInviteResponsesEnabled,
  resolveRsvpOccurrenceId,
  selectApplicableRsvp,
} from '@lfx-one/shared/utils';
import { MeetingService } from '@services/meeting.service';
import { catchError, map, of, switchMap, tap } from 'rxjs';

@Component({
  selector: 'lfx-meeting-rsvp-details',
  imports: [NgClass, ButtonComponent, MeetingAttendeePreviewComponent],
  templateUrl: './meeting-rsvp-details.component.html',
})
export class MeetingRsvpDetailsComponent {
  private readonly meetingService = inject(MeetingService);

  public readonly meeting: InputSignal<Meeting | PastMeeting> = input.required<Meeting | PastMeeting>();
  public readonly project: InputSignal<Partial<Project> | null> = input<Partial<Project> | null>(null);
  public readonly currentOccurrence: InputSignal<MeetingOccurrence | null> = input<MeetingOccurrence | null>(null);
  public readonly pastMeeting: InputSignal<boolean> = input<boolean>(false);
  public readonly showAddButton: InputSignal<boolean> = input<boolean>(false);
  /** Fixed-height faces row with "View all"; off where the page already lists guests (join page). */
  public readonly showAttendeePreview: InputSignal<boolean> = input<boolean>(false);

  public readonly backgroundColor: InputSignal<string | undefined> = input<string | undefined>(undefined);
  public readonly borderColor: InputSignal<string | undefined> = input<string | undefined>(undefined);
  public readonly additionalRegistrantsCount: InputSignal<number> = input<number>(0);
  // When supplied (non-null), the parent already fetched the roster (e.g. the join page's
  // getMyMeetingRegistrants() call) — this component reuses it instead of fetching its own,
  // avoiding a duplicate full-roster request. Null means "self-managed" (legacy behavior).
  public readonly initialRegistrants: InputSignal<MeetingRegistrant[] | null> = input<MeetingRegistrant[] | null>(null);
  public readonly initialRegistrantsLoading: InputSignal<boolean> = input<boolean>(false);
  /** Successful local writes, retained while the roster's query index catches up. */
  public readonly confirmedRsvps = input<MeetingRsvp[]>([]);
  public readonly addClicked = output<void>();
  public readonly viewAllClicked = output<void>();
  public readonly disabled: InputSignal<boolean> = input<boolean>(false);
  public readonly disabledMessage: InputSignal<string> = input<string>('RSVP not available for this meeting');

  private readonly externallyManaged: Signal<boolean> = computed(() => this.initialRegistrants() !== null);
  private readonly internalLoading: WritableSignal<boolean> = signal(true);
  public readonly loading: Signal<boolean> = computed(() =>
    this.externallyManaged() && !this.pastMeeting() ? this.initialRegistrantsLoading() : this.internalLoading()
  );
  private readonly resolvedOccurrenceId: Signal<string | undefined> = computed(() =>
    resolveRsvpOccurrenceId(this.meeting(), { occurrence: this.currentOccurrence() })
  );
  // Private source: one observable, two derived signals. Consolidates registrants + RSVPs
  // into a single HTTP call for the Me lens (where the backend doesn't populate counts),
  // and falls back to a direct RSVP fetch for the non-Me lens where counts are already populated.
  private readonly upcomingData: Signal<{ rsvps: MeetingRsvp[]; registrants: MeetingRegistrant[] }> = this.initializeUpcomingData();
  public readonly pastParticipants: Signal<PastMeetingParticipant[]> = this.initializePastParticipants();
  // Prefer the parent-supplied roster (when present and not viewing past-meeting data, which
  // always self-fetches participants) so a stale in-flight internal fetch can't win.
  public readonly registrants: Signal<MeetingRegistrant[]> = this.initializeRegistrants();
  public readonly rsvps: Signal<MeetingRsvp[]> = computed(() => {
    if (this.externallyManaged() && !this.pastMeeting()) {
      return this.registrants()
        .map((r) => r.rsvp)
        .filter((r): r is MeetingRsvp => r != null);
    }
    return [...this.applicableConfirmedRsvps(), ...this.upcomingData().rsvps.filter((rsvp) => this.isApplicableRsvp(rsvp))];
  });
  public readonly inviteResponsesEnabled: Signal<boolean> = computed(() => isMeetingInviteResponsesEnabled(this.meeting()));
  // Registrants when the roster was fetched (Me lens); otherwise the RSVP rows the project and
  // foundation lens cards load, which still name the people who responded.
  public readonly previewPeople: Signal<MeetingAttendeePreviewPerson[]> = computed(() => {
    const registrants = this.registrants();
    if (registrants.length > 0) {
      return buildAttendeePreviewFromRegistrants(registrants, { inviteResponsesEnabled: this.inviteResponsesEnabled() });
    }
    return buildAttendeePreviewFromRsvps(this.rsvps(), this.resolvedOccurrenceId());
  });
  public readonly rsvpCounts: Signal<RsvpCounts> = this.initializeRsvpCounts();
  public readonly acceptedCount: Signal<number> = computed(() => this.rsvpCounts().accepted);
  public readonly maybeCount: Signal<number> = computed(() => this.rsvpCounts().maybe);
  public readonly declinedCount: Signal<number> = computed(() => this.rsvpCounts().declined);
  public readonly meetingRegistrantCount: Signal<number> = this.initializeMeetingRegistrantCount();
  public readonly attendedCount: Signal<number> = this.initializeAttendedCount();
  public readonly attendancePercentage: Signal<number> = this.initializeAttendancePercentage();
  public readonly showPoorAttendanceWarning: Signal<boolean> = computed(() => this.pastMeeting() && this.attendancePercentage() < 50);
  public readonly backgroundClasses: Signal<string> = this.initializeBackgroundClasses();
  public readonly borderClasses: Signal<string> = this.initializeBorderClasses();
  public readonly headerTextClasses: Signal<string> = computed(() => (this.showPoorAttendanceWarning() ? 'text-amber-600' : 'text-gray-600'));
  public readonly summaryTextClasses: Signal<string> = computed(() => (this.showPoorAttendanceWarning() ? 'text-amber-900' : 'text-gray-900'));

  private initializeRegistrants(): Signal<MeetingRegistrant[]> {
    return computed(() => {
      const parentRoster = this.externallyManaged() && !this.pastMeeting();
      const registrants = parentRoster ? (this.initialRegistrants() ?? []) : this.upcomingData().registrants;
      const confirmed = this.applicableConfirmedRsvps();
      if (confirmed.length === 0 && !this.meeting().recurrence) return registrants;
      const occurrenceId = this.resolvedOccurrenceId();
      const rows = registrants.map((registrant) => {
        const responses = confirmed.filter((rsvp) => rsvp.registrant_id === registrant.uid);
        if (registrant.rsvp && this.isApplicableRsvp(registrant.rsvp)) responses.push(registrant.rsvp);
        const rsvp = selectApplicableRsvp(occurrenceId, responses);
        return rsvp !== (registrant.rsvp ?? null) ? { ...registrant, rsvp } : registrant;
      });
      // Without a roster (Foundation/Project cards) the RSVP-only path already counts confirmed answers.
      if (!parentRoster && registrants.length === 0) return rows;
      // A confirmed answer can precede its registration's first roster row; count and preview that guest too.
      const known = new Set(registrants.map((registrant) => registrant.uid));
      const unindexed = new Map<string, MeetingRsvp[]>();
      for (const rsvp of confirmed) {
        if (!known.has(rsvp.registrant_id)) unindexed.set(rsvp.registrant_id, [...(unindexed.get(rsvp.registrant_id) ?? []), rsvp]);
      }
      for (const responses of unindexed.values()) {
        const rsvp = selectApplicableRsvp(occurrenceId, responses);
        if (rsvp) rows.push(this.toUnindexedRegistrant(rsvp));
      }
      return rows;
    });
  }

  private toUnindexedRegistrant(rsvp: MeetingRsvp): MeetingRegistrant {
    return {
      uid: rsvp.registrant_id,
      meeting_id: rsvp.meeting_id,
      email: rsvp.email,
      first_name: rsvp.name?.trim() ?? '',
      last_name: '',
      host: false,
      job_title: null,
      org_name: null,
      occurrence_id: null,
      org_is_member: false,
      org_is_project_member: false,
      avatar_url: null,
      username: rsvp.username || null,
      linkedin_profile: null,
      created_at: rsvp.created_at,
      updated_at: rsvp.updated_at ?? rsvp.created_at,
      type: 'direct',
      invite_accepted: null,
      attended: null,
      rsvp,
    };
  }

  private applicableConfirmedRsvps(): MeetingRsvp[] {
    if (this.pastMeeting()) return [];
    const meeting = this.meeting();
    return this.confirmedRsvps().filter((rsvp) => rsvp.meeting_id === meeting.id && this.isApplicableRsvp(rsvp));
  }

  private isApplicableRsvp(rsvp: MeetingRsvp): boolean {
    const occurrenceId = this.resolvedOccurrenceId();
    if (this.meeting().recurrence && !occurrenceId) return rsvp.scope === 'all';
    return !!selectApplicableRsvp(occurrenceId, [rsvp]);
  }

  private initializeUpcomingData(): Signal<{ rsvps: MeetingRsvp[]; registrants: MeetingRegistrant[] }> {
    // The roster carries one answer per guest for the requested date, so a date change must refetch it.
    const source = computed(() => ({ meeting: this.meeting(), occurrenceId: this.resolvedOccurrenceId() }));
    return toSignal(
      toObservable(source).pipe(
        tap(() => {
          if (!this.pastMeeting()) this.internalLoading.set(true);
        }),
        switchMap(({ meeting, occurrenceId }) => {
          if (this.pastMeeting() || this.externallyManaged()) {
            return of({ rsvps: [] as MeetingRsvp[], registrants: [] as MeetingRegistrant[] });
          }
          const inviteResponsesEnabled = isMeetingInviteResponsesEnabled(meeting);
          // Me lens (backend split counts not populated) — one call for both registrants + RSVPs.
          if (!this.hasBackendRegistrantCounts(meeting)) {
            // Pre-feature Me-lens cards already carry aggregate `registrant_count`; the
            // invitee-count-only UI reads that field, so skip the roster fetch (GH-1951).
            if (!inviteResponsesEnabled && meeting.registrant_count !== undefined) {
              return of({ rsvps: [] as MeetingRsvp[], registrants: [] as MeetingRegistrant[] });
            }
            // Resolve RSVPs against the target occurrence so a `single` decline for a
            // future date doesn't overwrite the current occurrence's per-registrant
            // chip (LFXV2-2864). Skip attaching RSVPs when tracking is disabled (GH-1951).
            const allDatesOnly = inviteResponsesEnabled && !!meeting.recurrence && !occurrenceId;
            return this.meetingService.getMeetingRegistrants(meeting.id, inviteResponsesEnabled, occurrenceId, false, undefined, false, allDatesOnly).pipe(
              map((registrants) => ({
                registrants,
                rsvps: inviteResponsesEnabled ? registrants.map((r) => r.rsvp).filter((r): r is MeetingRsvp => r != null) : [],
              })),
              catchError((error) => {
                console.error('Failed to fetch meeting registrants:', error);
                return of({ rsvps: [] as MeetingRsvp[], registrants: [] as MeetingRegistrant[] });
              })
            );
          }
          if (!inviteResponsesEnabled) {
            return of({ rsvps: [] as MeetingRsvp[], registrants: [] as MeetingRegistrant[] });
          }
          // Non-Me lens — counts are already on the meeting object, only need RSVPs.
          return this.meetingService.getMeetingRsvps(meeting.id).pipe(
            map((rsvps) => ({ rsvps, registrants: [] as MeetingRegistrant[] })),
            catchError((error) => {
              console.error('Failed to fetch meeting RSVPs:', error);
              return of({ rsvps: [] as MeetingRsvp[], registrants: [] as MeetingRegistrant[] });
            })
          );
        }),
        tap(() => {
          if (!this.pastMeeting()) this.internalLoading.set(false);
        })
      ),
      { initialValue: { rsvps: [] as MeetingRsvp[], registrants: [] as MeetingRegistrant[] } }
    );
  }

  private initializePastParticipants(): Signal<PastMeetingParticipant[]> {
    return toSignal(
      toObservable(this.meeting).pipe(
        tap(() => {
          if (this.pastMeeting()) this.internalLoading.set(true);
        }),
        switchMap((meeting) => {
          if (!this.pastMeeting()) {
            return of([] as PastMeetingParticipant[]);
          }
          return this.meetingService.getPastMeetingParticipants(meeting.id).pipe(
            catchError((error) => {
              console.error('Failed to fetch past meeting participants:', error);
              return of([] as PastMeetingParticipant[]);
            })
          );
        }),
        tap(() => {
          if (this.pastMeeting()) this.internalLoading.set(false);
        })
      ),
      { initialValue: [] }
    );
  }

  private hasBackendRegistrantCounts(meeting: Meeting | PastMeeting): boolean {
    return meeting.individual_registrants_count !== undefined || meeting.committee_members_count !== undefined;
  }

  private initializeRsvpCounts(): Signal<RsvpCounts> {
    return computed(() => {
      // Me lens: registrants are already hydrated with their occurrence-applicable
      // RSVP by the BFF. Tally via the registrant-aware counter so
      // `invite_accepted` (series-level Google Calendar invite state) falls back
      // in the same cases the guest chip does — keeps "N of M attending" in sync
      // with the drawer's per-registrant chips (LFXV2-2864).
      const registrants = this.registrants();
      if (registrants.length > 0) {
        return countRegistrantAttendance(registrants, { inviteResponsesEnabled: this.inviteResponsesEnabled() });
      }
      // Non-Me lens: no registrant array available (detail page — counts come off
      // meeting.individual_registrants_count). Fall back to RSVP-only tallying;
      // `invite_accepted` fallback is unreachable without registrants but the
      // typical detail-page case has explicit RSVPs anyway.
      const rsvps = this.rsvps();
      const occurrence = this.currentOccurrence() ?? getCurrentOrNextOccurrence(this.meeting());
      return calculateRsvpCounts(occurrence, rsvps);
    });
  }

  private initializeMeetingRegistrantCount(): Signal<number> {
    return computed(() => {
      const meeting = this.meeting();
      const additionalCount = this.additionalRegistrantsCount();

      if (this.pastMeeting()) {
        return this.pastParticipants().length + additionalCount;
      }

      // Parent-owned roster is already the live count — the base/additional split below only
      // applies to the legacy backend-counts path (meeting-card list), which this bypasses.
      if (this.externallyManaged()) {
        return this.registrants().length + additionalCount;
      }

      const splitCount = (meeting.individual_registrants_count || 0) + (meeting.committee_members_count || 0);
      // Me lens: splitCount is 0 (backend doesn't populate), fall back to the lazy-fetched registrants.
      // Non-Me lens: registrant_count may be populated by legacy paths that don't split; respect it.
      const baseCount = splitCount > 0 ? splitCount : (meeting.registrant_count ?? this.registrants().length);
      return baseCount + additionalCount;
    });
  }

  private initializeAttendedCount(): Signal<number> {
    return computed(() => {
      if (!this.pastMeeting()) return 0;
      return this.pastParticipants().filter((p) => p.is_attended).length;
    });
  }

  private initializeAttendancePercentage(): Signal<number> {
    return computed(() => {
      const total = this.meetingRegistrantCount();
      if (total === 0) {
        return 0;
      }

      if (this.pastMeeting()) {
        return Math.round((this.attendedCount() / total) * 100);
      }

      return Math.round((this.acceptedCount() / total) * 100);
    });
  }

  private initializeBackgroundClasses(): Signal<string> {
    return computed(() => {
      if (this.showPoorAttendanceWarning()) {
        return 'bg-amber-50';
      }
      return this.backgroundColor() || 'bg-gray-100/60';
    });
  }

  private initializeBorderClasses(): Signal<string> {
    return computed(() => {
      if (this.showPoorAttendanceWarning()) {
        return 'border border-amber-200';
      }
      if (this.borderColor()) {
        return `border ${this.borderColor()}`;
      }
      return '';
    });
  }
}
