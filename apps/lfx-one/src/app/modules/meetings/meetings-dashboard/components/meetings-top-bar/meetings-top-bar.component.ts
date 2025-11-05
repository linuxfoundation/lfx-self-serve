// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, computed, input, model, Signal } from '@angular/core';
import { Meeting } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-meetings-top-bar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './meetings-top-bar.component.html',
})
export class MeetingsTopBarComponent {
  public searchQuery = model.required<string>();
  public timeFilter = model.required<'upcoming' | 'past'>();
  public visibilityFilter = model.required<'mine' | 'public'>();
  public meetings = input.required<Meeting[]>();
  public viewMode = input<'list' | 'calendar'>('list');

  public upcomingCount: Signal<number>;
  public pastCount: Signal<number>;
  public mineCount: Signal<number>;
  public publicCount: Signal<number>;

  public constructor() {
    this.upcomingCount = this.initializeUpcomingCount();
    this.pastCount = this.initializePastCount();
    this.mineCount = this.initializeMineCount();
    this.publicCount = this.initializePublicCount();
  }

  public onSearchInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.searchQuery.set(value);
  }

  public onTimeFilterClick(value: 'upcoming' | 'past'): void {
    if (this.viewMode() !== 'calendar') {
      this.timeFilter.set(value);
    }
  }

  public onVisibilityFilterClick(value: 'mine' | 'public'): void {
    this.visibilityFilter.set(value);
  }

  public get isCalendarView(): boolean {
    return this.viewMode() === 'calendar';
  }

  private initializeUpcomingCount(): Signal<number> {
    return computed(() => {
      const now = new Date();
      return this.meetings().filter((meeting) => {
        const meetingEndTime = new Date(meeting.start_time);
        meetingEndTime.setMinutes(meetingEndTime.getMinutes() + meeting.duration + 40);
        return meetingEndTime >= now;
      }).length;
    });
  }

  private initializePastCount(): Signal<number> {
    return computed(() => {
      const now = new Date();
      return this.meetings().filter((meeting) => {
        const meetingEndTime = new Date(meeting.start_time);
        meetingEndTime.setMinutes(meetingEndTime.getMinutes() + meeting.duration + 40);
        return meetingEndTime < now;
      }).length;
    });
  }

  private initializeMineCount(): Signal<number> {
    return computed(() => {
      return this.meetings().filter((meeting) => meeting.visibility?.toLowerCase() === 'private').length;
    });
  }

  private initializePublicCount(): Signal<number> {
    return computed(() => {
      return this.meetings().filter((meeting) => meeting.visibility?.toLowerCase() === 'public').length;
    });
  }
}
