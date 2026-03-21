// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { Component, computed, effect, inject, input, signal, Signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { CardComponent } from '@components/card/card.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { Committee, Meeting, PastMeeting } from '@lfx-one/shared/interfaces';
import { MeetingCardComponent } from '@app/modules/meetings/components/meeting-card/meeting-card.component';
import { MeetingService } from '@services/meeting.service';
import { SkeletonModule } from 'primeng/skeleton';
import { debounceTime, distinctUntilChanged, filter, finalize, startWith, switchMap, tap } from 'rxjs';

type TimeFilter = 'upcoming' | 'past';

@Component({
  selector: 'lfx-committee-meetings',
  imports: [NgClass, ReactiveFormsModule, CardComponent, InputTextComponent, MeetingCardComponent, SkeletonModule],
  templateUrl: './committee-meetings.component.html',
  styleUrl: './committee-meetings.component.scss',
})
export class CommitteeMeetingsComponent {
  private readonly meetingService = inject(MeetingService);

  // Inputs
  public committee = input.required<Committee>();
  public canEdit = input<boolean>(false);
  public initialTimeFilter = input<TimeFilter>('upcoming');

  // Filter state
  public searchForm = new FormGroup({ search: new FormControl('') });
  public searchControl = this.searchForm.get('search') as FormControl;
  public timeFilter = signal<TimeFilter>('upcoming');

  // Time filter options
  public timeOptions: { label: string; value: TimeFilter }[] = [
    { label: 'Upcoming', value: 'upcoming' },
    { label: 'Past', value: 'past' },
  ];

  // Sync timeFilter with initialTimeFilter input changes
  private readonly syncTimeFilter = effect(
    () => {
      this.timeFilter.set(this.initialTimeFilter());
    },
    { allowSignalWrites: true }
  );

  // Loading state
  public meetingsLoading = signal(true);
  public pastMeetingsLoading = signal(false);

  // Data — upcoming fetched immediately, past lazy-loaded on first filter switch
  public meetings: Signal<Meeting[]> = this.initMeetings();
  public pastMeetings = signal<PastMeeting[]>([]);
  private pastMeetingsInitialized = false;

  // Lazy-load past meetings when the time filter switches to 'past'
  private readonly lazyLoadPastMeetings = effect(
    () => {
      if (this.timeFilter() === 'past' && !this.pastMeetingsInitialized && this.committee()?.uid) {
        this.pastMeetingsInitialized = true;
        this.pastMeetingsLoading.set(true);
        this.meetingService
          .getPastMeetingsByCommittee(this.committee().uid)
          .pipe(finalize(() => this.pastMeetingsLoading.set(false)))
          .subscribe((data) => this.pastMeetings.set(data));
      }
    },
    { allowSignalWrites: true }
  );

  // Loading computed: true when active tab's data is loading
  public loading: Signal<boolean> = computed(() => (this.timeFilter() === 'upcoming' ? this.meetingsLoading() : this.pastMeetingsLoading()));

  // Filtered data
  public filteredMeetings: Signal<(Meeting | PastMeeting)[]> = this.initFilteredMeetings();

  public setTimeFilter(value: TimeFilter): void {
    this.timeFilter.set(value);
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
    const searchTerm = toSignal(this.searchControl.valueChanges.pipe(startWith(''), debounceTime(300), distinctUntilChanged()), { initialValue: '' });

    return computed(() => {
      const time = this.timeFilter();
      const term = (searchTerm() || '').toLowerCase();
      const items: (Meeting | PastMeeting)[] = time === 'upcoming' ? this.meetings() : this.pastMeetings();

      if (!term) {
        return items;
      }

      return items.filter((m) => {
        const title = 'title' in m ? m.title : '';
        return title.toLowerCase().includes(term);
      });
    });
  }
}
