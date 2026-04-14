// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input, OnInit, output } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';

@Component({
  selector: 'lfx-meetings-top-bar',

  imports: [ReactiveFormsModule, InputTextComponent, SelectComponent],
  templateUrl: './meetings-top-bar.component.html',
})
export class MeetingsTopBarComponent implements OnInit {
  public meetingTypeOptions = input.required<{ label: string; value: string | null }[]>();
  public foundationOptions = input<{ label: string; value: string }[]>([]);
  public projectOptions = input<{ label: string; value: string }[]>([]);
  public showFoundationFilter = input<boolean>(false);
  public showProjectFilter = input<boolean>(false);
  public readonly initialTimeFilter = input<'upcoming' | 'past'>('upcoming');
  public readonly meetingTypeChange = output<string | null>();
  public readonly foundationFilterChange = output<string | null>();
  public readonly projectFilterChange = output<string | null>();
  public readonly searchQueryChange = output<string>();
  public readonly timeFilterChange = output<'upcoming' | 'past'>();

  public searchForm: FormGroup;
  public timeFilterOptions: { label: string; value: 'upcoming' | 'past' }[];

  public constructor() {
    // Initialize time filter options
    this.timeFilterOptions = [
      { label: 'Upcoming', value: 'upcoming' },
      { label: 'Past', value: 'past' },
    ];

    // Initialize form
    this.searchForm = new FormGroup({
      search: new FormControl(''),
      meetingType: new FormControl<string | null>(null),
      foundationFilter: new FormControl<string | null>(null),
      projectFilter: new FormControl<string | null>(null),
      timeFilter: new FormControl<'upcoming' | 'past'>('upcoming'),
    });

    // Subscribe to form changes and emit events
    this.searchForm
      .get('search')
      ?.valueChanges.pipe(takeUntilDestroyed())
      .subscribe((value) => {
        this.searchQueryChange.emit(value || '');
      });

    // Subscribe to time filter changes
    this.searchForm
      .get('timeFilter')
      ?.valueChanges.pipe(takeUntilDestroyed())
      .subscribe((value) => {
        if (value) {
          this.timeFilterChange.emit(value);
          this.searchForm.get('foundationFilter')?.setValue(null, { emitEvent: false });
          this.searchForm.get('projectFilter')?.setValue(null, { emitEvent: false });
        }
      });
  }

  public ngOnInit(): void {
    const initial = this.initialTimeFilter();
    if (initial !== 'upcoming') {
      this.searchForm.get('timeFilter')?.setValue(initial, { emitEvent: false });
    }
  }

  public onMeetingTypeChange(value: string | null): void {
    this.meetingTypeChange.emit(value);
  }

  public onFoundationFilterChange(value: string | null): void {
    this.foundationFilterChange.emit(value);
    // Reset project filter when foundation changes
    this.searchForm.get('projectFilter')?.setValue(null, { emitEvent: false });
    this.projectFilterChange.emit(null);
  }

  public onProjectFilterChange(value: string | null): void {
    this.projectFilterChange.emit(value);
  }

  public onTimeFilterChange(value: 'upcoming' | 'past'): void {
    this.timeFilterChange.emit(value);
  }
}
