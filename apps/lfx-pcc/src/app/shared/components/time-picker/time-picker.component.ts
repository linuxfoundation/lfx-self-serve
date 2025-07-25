// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CommonModule } from '@angular/common';
import { Component, computed, input, OnDestroy, OnInit, signal, viewChild } from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { TimePickerProps } from '@lfx-pcc/shared/interfaces';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { Popover, PopoverModule } from 'primeng/popover';
import { Subscription } from 'rxjs';

interface TimeOption {
  label: string;
  value: string;
}

interface TimePickerData {
  value: string | null;
  searchQuery: string;
}

@Component({
  selector: 'lfx-time-picker',
  standalone: true,
  imports: [InputTextModule, PopoverModule, ButtonModule, ReactiveFormsModule, CommonModule],
  templateUrl: './time-picker.component.html',
  styleUrls: ['./time-picker.component.scss'],
})
export class TimePickerComponent implements OnInit, OnDestroy {
  // Required form inputs following LFX pattern
  public form = input.required<FormGroup>();
  public control = input.required<string>();

  // Optional properties
  public readonly label = input<TimePickerProps['label']>('');
  public readonly placeholder = input<TimePickerProps['placeholder']>('Select or type time');
  public readonly required = input<TimePickerProps['required']>(false);
  public readonly size = input<TimePickerProps['size']>('small');
  public readonly width = input<string>('w-32');

  // ViewChild for popover control
  public timePopover = viewChild<Popover>('timePopover');

  // Time options signal
  public timeOptions = signal<TimeOption[]>([]);

  // Unified state management
  private pickerState = signal<TimePickerData>({
    value: null,
    searchQuery: '',
  });

  // Subscription to form control value changes
  private valueChangesSubscription?: Subscription;

  public visibleTimeOptions = computed(() => {
    const state = this.pickerState();
    const query = state.searchQuery.toLowerCase().trim();
    const options = this.timeOptions();

    if (query === '') {
      return options; // Show all options when no search query
    }

    // Filter options that match the query more precisely
    return options.filter((option) => {
      const label = option.label.toLowerCase();

      // Exact match or starts with query followed by colon, space, or end
      if (label === query || label.startsWith(query + ':') || label.startsWith(query + ' ')) {
        return true;
      }

      // Match if query starts with hour and matches the time format
      const hourMatch = query.match(/^(\d{1,2}):?(\d{0,2})/);
      if (hourMatch) {
        const hour = hourMatch[1];
        const minutes = hourMatch[2];

        // If just hour, match times starting with that hour
        if (!minutes) {
          return label.startsWith(hour + ':');
        }

        // If hour and minutes, match exact time format
        return label.startsWith(hour + ':' + minutes);
      }

      // Match AM/PM
      if (query === 'a' || query === 'am') return label.includes(' am');
      if (query === 'p' || query === 'pm') return label.includes(' pm');

      return false;
    });
  });

  public constructor() {
    this.timeOptions.set(this.generateTimeOptions());
  }

  public ngOnInit(): void {
    // Subscribe to form control value changes
    const formControl = this.form().get(this.control());
    if (formControl) {
      // Set initial value
      this.updateState({ value: formControl.value || null });

      // Subscribe to value changes
      this.valueChangesSubscription = formControl.valueChanges.subscribe((value: string | null) => {
        this.updateState({ value });
      });
    }
  }

  public ngOnDestroy(): void {
    // Clean up subscription
    if (this.valueChangesSubscription) {
      this.valueChangesSubscription.unsubscribe();
    }
  }

  // Public methods
  public onInputFocus(event: FocusEvent): void {
    // Always show popover on focus
    this.timePopover()?.show(event);
  }

  public onTimeOptionClick(timeOption: TimeOption): void {
    // User selected an option, clear search query
    this.updateState({
      searchQuery: '',
    });

    // Set the selected time option
    const formControl = this.form().get(this.control());
    if (formControl) {
      formControl.setValue(timeOption.value);
    }

    // Hide the popover
    this.timePopover()?.hide();
  }

  public onInput(event: Event): void {
    const inputValue = (event.target as HTMLInputElement).value;

    // Update search query
    this.updateState({
      searchQuery: inputValue || '',
    });

    // Always show popover when typing
    this.timePopover()?.show(event);
  }

  public onInputBlur(event: Event): void {
    // Convert time format when user finishes typing (on blur)
    const inputValue = (event.target as HTMLInputElement).value;
    if (inputValue) {
      const convertedTime = this.convertTimeFormat(inputValue);
      if (convertedTime !== inputValue) {
        const formControl = this.form().get(this.control());
        if (formControl) {
          formControl.setValue(convertedTime);
        }
      }
    }
  }

  // Private methods
  private updateState(updates: Partial<TimePickerData>): void {
    this.pickerState.update((current) => ({
      ...current,
      ...updates,
    }));
  }
  private generateTimeOptions(): TimeOption[] {
    const options: TimeOption[] = [];

    // Generate 15-minute intervals for 24 hours (96 total options)
    for (let hour = 0; hour < 24; hour++) {
      for (let minute = 0; minute < 60; minute += 15) {
        const timeString = this.formatTime(hour, minute);
        options.push({
          label: timeString,
          value: timeString,
        });
      }
    }

    return options;
  }

  private formatTime(hour: number, minute: number): string {
    const period = hour >= 12 ? 'PM' : 'AM';
    let displayHour: number;
    if (hour === 0) {
      displayHour = 12;
    } else if (hour > 12) {
      displayHour = hour - 12;
    } else {
      displayHour = hour;
    }
    const displayMinute = minute.toString().padStart(2, '0');

    return `${displayHour}:${displayMinute} ${period}`;
  }

  private convertTimeFormat(input: string): string {
    // Remove extra spaces and normalize input
    const cleanedInput = input.trim();

    // Check if it's already in 12-hour format (contains AM/PM)
    if (/[ap]m/i.test(cleanedInput)) {
      return this.normalizeTime(cleanedInput);
    }

    // Check if it's in 24-hour format (HH:MM, H:MM, or HHMM)
    const time24WithColonMatch = cleanedInput.match(/^(\d{1,2}):(\d{2})$/);
    const time24NoColonMatch = cleanedInput.match(/^(\d{3,4})$/);

    if (time24WithColonMatch) {
      const hour = parseInt(time24WithColonMatch[1], 10);
      const minute = parseInt(time24WithColonMatch[2], 10);

      if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
        return this.formatTime(hour, minute);
      }
    } else if (time24NoColonMatch) {
      const timeString = time24NoColonMatch[1];
      let hour: number;
      let minute: number;

      if (timeString.length === 3) {
        // Handle 3-digit format like "130" (1:30)
        hour = parseInt(timeString.substring(0, 1), 10);
        minute = parseInt(timeString.substring(1), 10);
      } else {
        // Handle 4-digit format like "2400" (24:00)
        hour = parseInt(timeString.substring(0, 2), 10);
        minute = parseInt(timeString.substring(2), 10);
      }

      if (hour >= 0 && hour <= 24 && minute >= 0 && minute <= 59) {
        // Handle 24:00 as midnight (0:00)
        const adjustedHour = hour === 24 ? 0 : hour;
        return this.formatTime(adjustedHour, minute);
      }
    }

    // Check for simple hour input (e.g., "9" -> "9:00 AM")
    const hourMatch = cleanedInput.match(/^(\d{1,2})$/);
    if (hourMatch) {
      const hour = parseInt(hourMatch[1], 10);
      if (hour >= 1 && hour <= 24) {
        const adjustedHour = hour === 24 ? 0 : hour;
        return this.formatTime(adjustedHour, 0);
      }
    }

    return cleanedInput; // Return original if no conversion needed
  }

  private normalizeTime(timeString: string): string {
    // Normalize AM/PM format to consistent format
    const match = timeString.match(/^(\d{1,2}):?(\d{2})?\s*([ap]m?)/i);
    if (match) {
      const hour = parseInt(match[1], 10);
      const minute = match[2] ? parseInt(match[2], 10) : 0;
      const period = match[3].toLowerCase().includes('p') ? 'PM' : 'AM';

      if (hour >= 1 && hour <= 12 && minute >= 0 && minute <= 59) {
        let adjustedHour: number;
        if (period === 'PM' && hour !== 12) {
          adjustedHour = hour + 12;
        } else if (period === 'AM' && hour === 12) {
          adjustedHour = 0;
        } else {
          adjustedHour = hour;
        }
        return this.formatTime(adjustedHour, minute);
      }
    }

    return timeString;
  }
}
