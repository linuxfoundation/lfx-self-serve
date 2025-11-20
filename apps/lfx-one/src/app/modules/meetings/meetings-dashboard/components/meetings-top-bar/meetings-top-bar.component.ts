// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, computed, input, model, Signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { Meeting } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-meetings-top-bar',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, InputTextComponent],
  templateUrl: './meetings-top-bar.component.html',
})
export class MeetingsTopBarComponent {
  public searchQuery = model.required<string>();
  public timeFilter = model.required<'upcoming' | 'past'>();
  public visibilityFilter = model.required<'mine' | 'public'>();
  public meetings = input.required<Meeting[]>();

  public mineCount: Signal<number>;
  public publicCount: Signal<number>;
  public searchForm: FormGroup;

  public constructor() {
    this.mineCount = this.initializeMineCount();
    this.publicCount = this.initializePublicCount();

    // Initialize form
    this.searchForm = new FormGroup({
      search: new FormControl(''),
    });

    // Subscribe to form changes and update signal
    this.searchForm.get('search')?.valueChanges.subscribe((value) => {
      this.searchQuery.set(value || '');
    });
  }

  public onTimeFilterClick(value: 'upcoming' | 'past'): void {
    this.timeFilter.set(value);
  }

  public onVisibilityFilterClick(value: 'mine' | 'public'): void {
    this.visibilityFilter.set(value);
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
