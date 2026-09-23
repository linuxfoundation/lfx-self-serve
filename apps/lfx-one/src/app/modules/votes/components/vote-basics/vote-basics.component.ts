// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { LowerCasePipe } from '@angular/common';
import { Component, computed, DestroyRef, inject, input, Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { Committee } from '@lfx-one/shared/interfaces';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { CalendarComponent } from '@components/calendar/calendar.component';
import { CommitteeSelectorComponent } from '@components/committee-selector/committee-selector.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { SelectComponent } from '@components/select/select.component';
import { TimePickerComponent } from '@components/time-picker/time-picker.component';
import { TextareaComponent } from '@components/textarea/textarea.component';
import { COMMITTEE_LABEL, VOTE_ALLOW_ABSTAIN_OPTIONS, VOTE_ELIGIBLE_PARTICIPANTS, VOTE_LABEL } from '@lfx-one/shared/constants';
import { buildTimezoneOptions, getTimezoneUtcOffsetString, parseTime12Hour, startOfTodayInTimezone } from '@lfx-one/shared/utils';

@Component({
  selector: 'lfx-vote-basics',
  imports: [
    ReactiveFormsModule,
    InputTextComponent,
    TextareaComponent,
    SelectComponent,
    CalendarComponent,
    TimePickerComponent,
    CommitteeSelectorComponent,
    LowerCasePipe,
  ],
  templateUrl: './vote-basics.component.html',
})
export class VoteBasicsComponent {
  private readonly destroyRef = inject(DestroyRef);
  // Armed only by the timezone select's own change event — the subscriber's proof that a floor
  // change came from the organizer's pick. The dirty flag can't prove this: it is sticky across
  // patchValue, so a reused :id/edit component hydrating another vote (or a post-midnight floor
  // advance) would read a stale dirty as a fresh zone switch. Single-shot: each pick's own
  // emission consumes the arm, so a spent pick never lingers into a later floor advance.
  private userPickedZone: string | null = null;

  // Inputs
  public readonly form = input.required<FormGroup>();
  public readonly formValue = input.required<Signal<Record<string, unknown>>>();
  public readonly isEditMode = input<boolean>(false);
  public readonly committeeContext = input<Committee | null>(null);

  // Constants
  public readonly committeeLabel = COMMITTEE_LABEL;
  public readonly voteLabel = VOTE_LABEL;
  public readonly eligibleParticipantsOptions = [...VOTE_ELIGIBLE_PARTICIPANTS];
  public readonly allowAbstainOptions = [...VOTE_ALLOW_ABSTAIN_OPTIONS];
  // Cosmetic floor only — the group-level voteDeadlineValidator does the real zone-aware future check.
  // Derived from the selected zone so a zone behind the browser (e.g. Honolulu vs Sydney) keeps its valid "today" selectable.
  public readonly minDate: Signal<Date> = this.initMinDate();
  // Clears a close_date stranded when a user's timezone pick moves minDate past it. The guards keep
  // hydration and clock rollovers from wiping it: the previous-minDate floor (a past deadline is
  // never re-stranded), plus requiring the select's own change event AND an actual zone change —
  // patchValue hydration and post-midnight floor advances satisfy neither.
  private readonly clearStaleCloseDate: Subscription = this.initClearStaleCloseDate();
  public readonly timezoneOptions: Signal<{ label: string; value: string }[]> = this.initTimezoneOptions();

  /** Arms the clearStaleCloseDate gate from the select's own change event — the only causal signal that the organizer picked the current zone. */
  public onTimezoneUserPick(zone: string): void {
    this.userPickedZone = zone;
  }

  // Offset labels must reflect the picked wall-clock date/time — static catalog offsets lie across DST boundaries,
  // and date-only midnight mislabels DST transition evenings (Nov 1 2026 New York: midnight UTC-04, 11:59 PM UTC-05).
  private initTimezoneOptions(): Signal<{ label: string; value: string }[]> {
    return computed(() => {
      this.formValue()();
      const closeDate = (this.form().get('close_date')?.value as Date | null) ?? new Date();
      const closeTime = this.form().get('close_time')?.value as string;
      const timezone = this.form().get('timezone')?.value as string;
      // getTimezoneOffset reads the Date's wall-clock fields per candidate zone, so pass the picked
      // date/time unconverted — converting through the selected zone first would label every other
      // zone for the wrong wall time across a DST boundary (Mar 8 3:30 AM Tokyo → New York is -04:00, not -05:00).
      const parsed = closeTime ? parseTime12Hour(closeTime) : null;
      const deadline = parsed ? new Date(closeDate.getFullYear(), closeDate.getMonth(), closeDate.getDate(), parsed.hours, parsed.minutes) : closeDate;
      const options = buildTimezoneOptions(deadline);
      // A detected zone absent from the curated catalog (e.g. America/Phoenix) would render the
      // required select blank despite holding a value — surface it as a synthesized option.
      if (timezone && !options.some((option) => option.value === timezone)) {
        const offset = getTimezoneUtcOffsetString(timezone, deadline);
        return [{ label: offset ? `${timezone} (${offset})` : timezone, value: timezone }, ...options];
      }
      return options;
    });
  }

  private initMinDate(): Signal<Date> {
    // Full form-value dependency so an edit landing after midnight in the selected zone advances the
    // floor; equal on the epoch dedupes same-day recomputes, so a fresh Date per keystroke never
    // re-fires the clearStaleCloseDate subscriber.
    return computed(() => startOfTodayInTimezone(this.formValue()()['timezone'] as string), {
      equal: (a, b) => a.getTime() === b.getTime(),
    });
  }

  private initClearStaleCloseDate(): Subscription {
    let previousMinDate: Date | undefined;
    let previousTimezone: string | undefined;
    // Observe floor + zone together: a same-day switch between zones sharing a UTC offset (e.g.
    // New York → Toronto) leaves the floor epoch unchanged, so watching the floor alone would never
    // emit for it — previousTimezone would go stale and the armed pick would linger until a
    // post-midnight floor advance misread it as a fresh zone switch. Equality on both fields still
    // dedupes unrelated same-day edits.
    const floorAndZone = computed(() => ({ floor: this.minDate(), timezone: this.formValue()()['timezone'] as string }), {
      equal: (a, b) => a.floor.getTime() === b.floor.getTime() && a.timezone === b.timezone,
    });
    return toObservable(floorAndZone)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(({ floor: minDate, timezone }) => {
        const control = this.form().get('close_date');
        const closeDate = control?.value as Date | null;
        // A user zone switch is causally exact: the armed pick must match the zone in effect AND the
        // zone must have changed in this emission. Hydration patches never fire the select's change
        // event, and a calendar-day rollover moves the floor without touching the zone.
        const zoneChanged = previousTimezone !== undefined && timezone !== previousTimezone;
        const userZoneSwitch = this.userPickedZone !== null && this.userPickedZone === timezone;
        const stranded =
          previousMinDate !== undefined &&
          closeDate instanceof Date &&
          zoneChanged &&
          userZoneSwitch &&
          closeDate.getTime() >= previousMinDate.getTime() &&
          closeDate.getTime() < minDate.getTime();
        if (stranded) {
          control?.setValue(null);
          // Surface the required error immediately — setValue alone leaves the control untouched,
          // and the template gates the error on touched.
          control?.markAsTouched();
        }
        previousMinDate = minDate;
        previousTimezone = timezone;
        // Consume the arm: the pick's own zone change always emits (zone is part of the observed
        // state), so whatever arm an emission sees is the pick that caused it.
        this.userPickedZone = null;
      });
  }
}
