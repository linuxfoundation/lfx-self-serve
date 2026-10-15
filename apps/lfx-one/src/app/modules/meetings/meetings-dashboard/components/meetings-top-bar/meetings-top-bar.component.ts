// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, input, output, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { CardTabsBarComponent } from '@components/card-tabs-bar/card-tabs-bar.component';
import { CheckboxComponent } from '@components/checkbox/checkbox.component';
import { FilterPillsComponent } from '@components/filter-pills/filter-pills.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { FilterPillOption, MeetingDashboardView, MeetingResponseFilter } from '@lfx-one/shared/interfaces';
import { combineLatest } from 'rxjs';

@Component({
  selector: 'lfx-meetings-top-bar',
  imports: [ReactiveFormsModule, InputTextComponent, SelectComponent, FilterPillsComponent, CardTabsBarComponent, CheckboxComponent],
  templateUrl: './meetings-top-bar.component.html',
})
export class MeetingsTopBarComponent {
  public meetingTypeOptions = input.required<{ label: string; value: string | null }[]>();
  public foundationOptions = input<{ label: string; value: string | null }[]>([]);
  public projectOptions = input<{ label: string; value: string | null }[]>([]);
  public showFoundationFilter = input<boolean>(false);
  public showProjectFilter = input<boolean>(false);
  public readonly meetingView = input<MeetingDashboardView>('upcoming');
  public readonly showPersonalFilters = input<boolean>(false);
  public readonly responseFilter = input<MeetingResponseFilter>('all');
  public readonly organizedByMe = input<boolean>(false);
  public readonly hideDeclined = input<boolean>(false);
  public readonly allMeetingsCount = input<number | null>(null);
  public readonly pendingRsvpCount = input<number | null>(null);
  public readonly acceptedCount = input<number | null>(null);
  public readonly maybeCount = input<number | null>(null);
  public readonly declinedCount = input<number | null>(null);
  public readonly organizerCount = input<number | null>(null);
  public readonly meetingTypeFilter = input<string | null>(null);
  public readonly foundationFilter = input<string | null>(null);
  public readonly projectFilter = input<string | null>(null);

  public readonly meetingTypeChange = output<string | null>();
  public readonly foundationFilterChange = output<string | null>();
  public readonly projectFilterChange = output<string | null>();
  public readonly searchQuery = input<string>('');
  public readonly searchQueryChange = output<string>();
  public readonly meetingViewChange = output<MeetingDashboardView>();
  public readonly responseFilterChange = output<MeetingResponseFilter>();
  public readonly organizedByMeChange = output<boolean>();
  public readonly hideDeclinedChange = output<boolean>();

  public searchForm: FormGroup = new FormGroup({
    search: new FormControl(''),
    meetingType: new FormControl<string | null>(null),
    foundationFilter: new FormControl<string | null>(null),
    projectFilter: new FormControl<string | null>(null),
  });

  public readonly personalFiltersForm = new FormGroup({
    organizedByMe: new FormControl(false, { nonNullable: true }),
    hideDeclined: new FormControl(false, { nonNullable: true }),
  });

  public readonly organizerLabel = computed(() => this.formatCountLabel('Organized by me', this.organizerCount()));

  public readonly meetingViewOptions: FilterPillOption[] = [
    { id: 'upcoming', label: 'Upcoming' },
    { id: 'past', label: 'Past' },
  ];
  public readonly responseFilterOptions = this.initResponseFilterOptions();

  public constructor() {
    this.searchForm
      .get('search')
      ?.valueChanges.pipe(takeUntilDestroyed())
      .subscribe((value) => {
        this.searchQueryChange.emit(value || '');
      });

    this.personalFiltersForm.controls.organizedByMe.valueChanges.pipe(takeUntilDestroyed()).subscribe((value) => this.organizedByMeChange.emit(value));
    this.personalFiltersForm.controls.hideDeclined.valueChanges.pipe(takeUntilDestroyed()).subscribe((value) => this.hideDeclinedChange.emit(value));

    toObservable(computed(() => ({ organizedByMe: this.organizedByMe(), hideDeclined: this.hideDeclined() })))
      .pipe(takeUntilDestroyed())
      .subscribe((selections) => {
        const controls = this.personalFiltersForm.controls;
        if (controls.organizedByMe.value !== selections.organizedByMe || controls.hideDeclined.value !== selections.hideDeclined) {
          this.personalFiltersForm.setValue(selections, { emitEvent: false });
        }
      });

    combineLatest([toObservable(this.searchQuery), toObservable(this.meetingTypeFilter), toObservable(this.foundationFilter), toObservable(this.projectFilter)])
      .pipe(takeUntilDestroyed())
      .subscribe(([search, meetingType, foundationFilter, projectFilter]) => {
        const selections = { search, meetingType, foundationFilter, projectFilter };
        for (const [name, value] of Object.entries(selections)) {
          const control = this.searchForm.get(name);
          if (control?.value !== value) {
            control?.setValue(value, { emitEvent: false });
          }
        }
      });
  }

  public onMeetingTypeChange(value: string | null): void {
    this.meetingTypeChange.emit(value);
  }

  public onFoundationFilterChange(value: string | null): void {
    this.foundationFilterChange.emit(value);
    this.searchForm.get('projectFilter')?.setValue(null, { emitEvent: false });
    this.projectFilterChange.emit(null);
  }

  public onProjectFilterChange(value: string | null): void {
    this.projectFilterChange.emit(value);
  }

  public onMeetingViewChange(value: string): void {
    this.meetingViewChange.emit(value as MeetingDashboardView);
  }

  public onResponseFilterChange(value: string): void {
    this.responseFilterChange.emit(value as MeetingResponseFilter);
  }

  private initResponseFilterOptions(): Signal<FilterPillOption[]> {
    return computed<FilterPillOption[]>(() => {
      return [
        { id: 'all', label: this.formatCountLabel('All meetings', this.allMeetingsCount()) },
        { id: 'pending', label: this.formatCountLabel('Needs response', this.pendingRsvpCount()) },
        { id: 'accepted', label: this.formatCountLabel('Going', this.acceptedCount()) },
        { id: 'maybe', label: this.formatCountLabel('Maybe', this.maybeCount()) },
        { id: 'declined', label: this.formatCountLabel('Not going', this.declinedCount()) },
      ];
    });
  }

  private formatCountLabel(label: string, count: number | null): string {
    return count !== null && count > 0 ? `${label} (${count})` : label;
  }
}
