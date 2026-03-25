// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, inject, input, linkedSignal, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { CardComponent } from '@components/card/card.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { Committee, Meeting, PastMeeting } from '@lfx-one/shared/interfaces';
import { MEETING_TYPE_CONFIGS } from '@lfx-one/shared/constants';
import { MeetingCardComponent } from '@app/modules/meetings/components/meeting-card/meeting-card.component';
import { MeetingService } from '@services/meeting.service';
import { debounceTime, distinctUntilChanged, filter, finalize, startWith, switchMap, tap } from 'rxjs';

type TimeFilter = 'upcoming' | 'past';

@Component({
  selector: 'lfx-committee-meetings',
  imports: [ReactiveFormsModule, RouterLink, ButtonComponent, CardComponent, InputTextComponent, SelectComponent, MeetingCardComponent],
  templateUrl: './committee-meetings.component.html',
  styleUrl: './committee-meetings.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommitteeMeetingsComponent {
  private readonly meetingService = inject(MeetingService);

  // Inputs
  public committee = input.required<Committee>();
  public canEdit = input<boolean>(false);
  public initialTimeFilter = input<TimeFilter>('upcoming');

  // Filter state — linkedSignal tracks initialTimeFilter but allows local overrides
  public timeFilter = linkedSignal(() => this.initialTimeFilter());
  public meetingTypeFilter = signal<string | null>(null);

  // Form for search + filters — timeFilter synced with initialTimeFilter
  public searchForm = new FormGroup({
    search: new FormControl(''),
    meetingType: new FormControl<string | null>(null),
    timeFilter: new FormControl<TimeFilter>(this.initialTimeFilter()),
  });

  // Filter options
  public timeFilterOptions: { label: string; value: TimeFilter }[] = [
    { label: 'Upcoming', value: 'upcoming' },
    { label: 'Past', value: 'past' },
  ];

  public meetingTypeOptions: Signal<{ label: string; value: string | null }[]> = computed(() => {
    const types = Object.entries(MEETING_TYPE_CONFIGS).map(([, config]) => ({
      label: config.label,
      value: config.label,
    }));
    return [{ label: 'All Types', value: null }, ...types];
  });

  // Loading state
  public meetingsLoading = signal(true);
  public pastMeetingsLoading = signal(false);

  // Data — upcoming meetings
  public meetings: Signal<Meeting[]> = this.initMeetings();

  // Data — past meetings, lazy-loaded reactively when filter switches to 'past'
  public pastMeetings: Signal<PastMeeting[]> = toSignal(
    toObservable(computed(() => ({ time: this.timeFilter(), uid: this.committee()?.uid }))).pipe(
      filter(({ time, uid }) => time === 'past' && !!uid),
      distinctUntilChanged((a, b) => a.uid === b.uid),
      tap(() => this.pastMeetingsLoading.set(true)),
      switchMap(({ uid }) => this.meetingService.getPastMeetingsByCommittee(uid!).pipe(finalize(() => this.pastMeetingsLoading.set(false))))
    ),
    { initialValue: [] }
  );

  // Loading computed: true when active tab's data is loading
  public loading: Signal<boolean> = computed(() => (this.timeFilter() === 'upcoming' ? this.meetingsLoading() : this.pastMeetingsLoading()));

  // Filtered data
  public filteredMeetings: Signal<(Meeting | PastMeeting)[]> = this.initFilteredMeetings();

  /** Handles time filter change from dropdown — syncs signal and form control. */
  public onTimeFilterChange(value: TimeFilter): void {
    this.timeFilter.set(value);
    this.searchForm.get('timeFilter')?.setValue(value, { emitEvent: false });
  }

  /** Handles meeting type filter change from dropdown. */
  public onMeetingTypeChange(value: string | null): void {
    this.meetingTypeFilter.set(value);
  }

  // Private initializer functions
  private initMeetings(): Signal<Meeting[]> {
    return toSignal(
      toObservable(this.committee).pipe(
        filter((c) => !!c?.uid),
        tap(() => this.meetingsLoading.set(true)),
        switchMap((c) => this.meetingService.getMeetingsByCommittee(c.uid, undefined, 'start_time.asc').pipe(finalize(() => this.meetingsLoading.set(false))))
      ),
      { initialValue: [] }
    );
  }

  private initFilteredMeetings(): Signal<(Meeting | PastMeeting)[]> {
    const searchTerm = toSignal(
      (this.searchForm.get('search') as FormControl).valueChanges.pipe(startWith(''), debounceTime(300), distinctUntilChanged()),
      { initialValue: '' }
    );

    return computed(() => {
      const time = this.timeFilter();
      const term = (searchTerm() || '').toLowerCase();
      const typeFilter = this.meetingTypeFilter();
      const items: (Meeting | PastMeeting)[] = time === 'upcoming' ? this.meetings() : this.pastMeetings();

      return items.filter((m) => {
        const title = 'title' in m ? m.title : '';
        const meetingType = 'meeting_type' in m ? m.meeting_type : '';

        const matchesSearch = !term || title.toLowerCase().includes(term);
        const matchesType = !typeFilter || meetingType?.toLowerCase() === typeFilter.toLowerCase();

        return matchesSearch && matchesType;
      });
    });
  }
}
