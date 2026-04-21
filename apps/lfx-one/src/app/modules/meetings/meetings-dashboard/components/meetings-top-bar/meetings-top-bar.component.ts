// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, effect, input, output } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { FilterPillsComponent } from '@components/filter-pills/filter-pills.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { FilterPillOption } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-meetings-top-bar',
  imports: [ReactiveFormsModule, InputTextComponent, SelectComponent, FilterPillsComponent],
  templateUrl: './meetings-top-bar.component.html',
})
export class MeetingsTopBarComponent {
  public meetingTypeOptions = input.required<{ label: string; value: string | null }[]>();
  public foundationOptions = input<{ label: string; value: string | null }[]>([]);
  public projectOptions = input<{ label: string; value: string | null }[]>([]);
  public showFoundationFilter = input<boolean>(false);
  public showProjectFilter = input<boolean>(false);
  public readonly timeFilter = input<'upcoming' | 'past'>('upcoming');
  public readonly meetingTypeChange = output<string | null>();
  public readonly foundationFilterChange = output<string | null>();
  public readonly projectFilterChange = output<string | null>();
  public readonly searchQuery = input<string>('');
  public readonly searchQueryChange = output<string>();
  public readonly timeFilterChange = output<'upcoming' | 'past'>();

  public readonly timeTabOptions: FilterPillOption[] = [
    { id: 'upcoming', label: 'Upcoming' },
    { id: 'past', label: 'Past' },
  ];

  public searchForm: FormGroup = new FormGroup({
    search: new FormControl(''),
    meetingType: new FormControl<string | null>(null),
    foundationFilter: new FormControl<string | null>(null),
    projectFilter: new FormControl<string | null>(null),
  });

  public constructor() {
    this.searchForm
      .get('search')
      ?.valueChanges.pipe(takeUntilDestroyed())
      .subscribe((value) => {
        this.searchQueryChange.emit(value || '');
      });

    effect(() => {
      const query = this.searchQuery();
      if (this.searchForm.get('search')?.value !== query) {
        this.searchForm.get('search')?.setValue(query, { emitEvent: false });
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

  public onTimeTabChange(value: string): void {
    this.timeFilterChange.emit(value as 'upcoming' | 'past');
  }
}
