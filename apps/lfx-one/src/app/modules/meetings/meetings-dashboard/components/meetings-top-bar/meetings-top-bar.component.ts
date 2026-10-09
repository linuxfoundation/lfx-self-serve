// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, effect, input, output, Signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { FilterPillsComponent } from '@components/filter-pills/filter-pills.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { FilterPillOption, MeetingDashboardView } from '@lfx-one/shared/interfaces';

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
  public readonly meetingView = input<MeetingDashboardView>('upcoming');
  public readonly showPersonalViews = input<boolean>(false);
  public readonly pendingRsvpCount = input<number | null>(null);
  public readonly organizerCount = input<number | null>(null);
  public readonly meetingTypeFilter = input<string | null>(null);
  public readonly foundationFilter = input<string | null>(null);
  public readonly projectFilter = input<string | null>(null);
  public readonly acceptedOnly = input<boolean>(false);
  public readonly showAcceptedFilter = input<boolean>(false);
  public readonly acceptedCount = input<number>(0);
  public readonly showDeclined = input<boolean>(false);
  public readonly showDeclinedFilter = input<boolean>(false);
  public readonly declinedCount = input<number>(0);
  public readonly meetingTypeChange = output<string | null>();
  public readonly foundationFilterChange = output<string | null>();
  public readonly projectFilterChange = output<string | null>();
  public readonly searchQuery = input<string>('');
  public readonly searchQueryChange = output<string>();
  public readonly meetingViewChange = output<MeetingDashboardView>();
  public readonly showDeclinedChange = output<boolean>();
  public readonly acceptedOnlyChange = output<boolean>();

  public searchForm: FormGroup = new FormGroup({
    search: new FormControl(''),
    meetingType: new FormControl<string | null>(null),
    foundationFilter: new FormControl<string | null>(null),
    projectFilter: new FormControl<string | null>(null),
  });

  public readonly meetingViewOptions = this.initMeetingViewOptions();

  public constructor() {
    this.searchForm
      .get('search')
      ?.valueChanges.pipe(takeUntilDestroyed())
      .subscribe((value) => {
        this.searchQueryChange.emit(value || '');
      });

    effect(() => {
      const selections = {
        search: this.searchQuery(),
        meetingType: this.meetingTypeFilter(),
        foundationFilter: this.foundationFilter(),
        projectFilter: this.projectFilter(),
      };
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

  public onShowDeclinedChange(): void {
    this.showDeclinedChange.emit(!this.showDeclined());
  }

  public onToggleChip(id: string): void {
    if (id === 'accepted') {
      this.acceptedOnlyChange.emit(!this.acceptedOnly());
    }
  }

  private initMeetingViewOptions(): Signal<FilterPillOption[]> {
    return computed<FilterPillOption[]>(() => {
      const options: FilterPillOption[] = [
        { id: 'upcoming', label: 'Upcoming' },
        { id: 'past', label: 'Past' },
      ];
      if (this.showPersonalViews()) {
        const pendingCount = this.pendingRsvpCount();
        const organizerCount = this.organizerCount();
        options.push(
          { id: 'pending', label: pendingCount === null ? 'Pending RSVP' : `Pending RSVP (${pendingCount})` },
          { id: 'organizer', label: organizerCount === null ? 'Organized by me' : `Organized by me (${organizerCount})` }
        );
      }
      return options;
    });
  }
}
