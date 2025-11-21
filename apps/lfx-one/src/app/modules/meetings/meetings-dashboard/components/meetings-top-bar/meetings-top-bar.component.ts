// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, input, output } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { Meeting } from '@lfx-one/shared/interfaces';

@Component({
  selector: 'lfx-meetings-top-bar',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, InputTextComponent, SelectComponent],
  templateUrl: './meetings-top-bar.component.html',
})
export class MeetingsTopBarComponent {
  public meetingTypeOptions = input.required<{ label: string; value: string | null }[]>();
  public meetings = input.required<Meeting[]>();
  public readonly meetingTypeChange = output<string | null>();
  public readonly searchQueryChange = output<string>();

  public searchForm: FormGroup;

  public constructor() {
    // Initialize form
    this.searchForm = new FormGroup({
      search: new FormControl(''),
      meetingType: new FormControl<string | null>(null),
    });

    // Subscribe to form changes and emit events
    this.searchForm
      .get('search')
      ?.valueChanges.pipe(takeUntilDestroyed())
      .subscribe((value) => {
        this.searchQueryChange.emit(value || '');
      });
  }

  public onMeetingTypeChange(value: string | null): void {
    this.meetingTypeChange.emit(value);
  }
}
