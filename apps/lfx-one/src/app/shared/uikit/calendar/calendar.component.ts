// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { _IdGenerator } from '@angular/cdk/a11y';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  Injector,
  input,
  linkedSignal,
  model,
  Signal,
  signal,
  WritableSignal,
} from '@angular/core';
import { ControlValueAccessor, NgControl } from '@angular/forms';
import { UiCalendarDay, UiCalendarWeek } from '@lfx-one/shared/interfaces';
import { toLocalDateOnlyString } from '@lfx-one/shared/utils';

import { UiButtonComponent } from '../button/button.component';

/**
 * Inline month grid for picking one date, following the WAI-ARIA date grid pattern.
 * Arrow keys move by day and week, Home and End jump to the start and end of the week, Page Up and Page Down
 * change the month (with Shift, the year), and Enter or Space selects. Disabled dates stay focusable but cannot be selected.
 * Works with `[(value)]` and Angular forms. Dates are local calendar days at midnight, shown in English.
 */
@Component({
  selector: 'lfx-ui-calendar',
  imports: [UiButtonComponent],
  templateUrl: './calendar.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-block', '(focusout)': 'onFocusOut($event)' },
})
export class UiCalendarComponent implements ControlValueAccessor {
  // True from a keyboard or click move until focus is restored: a month change destroys the focused button and fires focusout with no target.
  private refocusing = false;
  private readonly titleBaseId = inject(_IdGenerator).getId('lfx-ui-calendar-');
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly ngControl = inject(NgControl, { self: true, optional: true });

  /** Rule that marks dates as unavailable, for example `(d) => d.getDay() === 0`. Those days are struck through. */
  public readonly isDateDisabled = input<(date: Date) => boolean>(() => false);
  /** First column of the week: `0` for Sunday, `1` for Monday. */
  public readonly weekStartsOn = input<0 | 1>(0);
  /** Accessible name for the grid when the month title is not enough. Leave empty to use the month title. */
  public readonly ariaLabel = input<string>('');
  /** The date treated as today. Defaults to the current date; pin it so a server and a client in another timezone agree near midnight. */
  public readonly today = input<Date | null>(null);
  /** The selected date, or `null`. Supports two-way binding with `[(value)]`. */
  public readonly value = model<Date | null>(null);

  protected readonly titleId = `${this.titleBaseId}title`;
  protected readonly formDisabled = signal(false);
  /** The date that holds the roving tab stop; its month is the month on show. Resets when the value changes. */
  protected readonly focusedDate: WritableSignal<Date> = linkedSignal(() => this.value() ?? this.startOfToday());
  protected readonly focusedKey: Signal<string> = computed(() => toLocalDateOnlyString(this.focusedDate()));
  protected readonly title: Signal<string> = computed(() => new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(this.focusedDate()));
  protected readonly weekdays: Signal<{ short: string; long: string }[]> = this.initWeekdays();
  protected readonly weeks: Signal<UiCalendarWeek[]> = this.initWeeks();

  private onChange: ((value: Date | null) => void) | null = null;
  private onTouched: (() => void) | null = null;

  public constructor() {
    if (this.ngControl) this.ngControl.valueAccessor = this;
  }

  public writeValue(value: Date | null): void {
    this.value.set(value ? this.startOfDay(value) : null);
  }

  public registerOnChange(fn: (value: Date | null) => void): void {
    this.onChange = fn;
  }

  public registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  public setDisabledState(isDisabled: boolean): void {
    this.formDisabled.set(isDisabled);
  }

  protected select(day: UiCalendarDay): void {
    if (this.formDisabled()) return;
    this.focusedDate.set(day.date);
    // Clicking a day from another month rebuilds the rows, so put focus back on the clicked day.
    this.focusActiveDay();
    if (day.disabled) return;
    this.value.set(day.date);
    this.onChange?.(day.date);
    this.onTouched?.();
  }

  protected shiftMonth(months: number): void {
    if (this.formDisabled()) return;
    this.focusedDate.set(this.addMonths(this.focusedDate(), months));
  }

  protected onFocusOut(event: FocusEvent): void {
    // Touched when focus leaves the whole calendar, not when it moves between its own buttons or a month rebuild drops it.
    if (this.refocusing || this.host.nativeElement.contains(event.relatedTarget as Node | null)) return;
    this.onTouched?.();
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (this.formDisabled()) return;
    const current = this.focusedDate();
    const weekStart = (current.getDay() - this.weekStartsOn() + 7) % 7;
    const next = {
      ArrowLeft: () => this.addDays(current, -1),
      ArrowRight: () => this.addDays(current, 1),
      ArrowUp: () => this.addDays(current, -7),
      ArrowDown: () => this.addDays(current, 7),
      Home: () => this.addDays(current, -weekStart),
      End: () => this.addDays(current, 6 - weekStart),
      PageUp: () => this.addMonths(current, event.shiftKey ? -12 : -1),
      PageDown: () => this.addMonths(current, event.shiftKey ? 12 : 1),
    }[event.key];
    if (!next) return;
    event.preventDefault();
    this.focusedDate.set(next());
    this.focusActiveDay();
  }

  private initWeekdays(): Signal<{ short: string; long: string }[]> {
    return computed(() => {
      const short = new Intl.DateTimeFormat('en-US', { weekday: 'short' });
      const long = new Intl.DateTimeFormat('en-US', { weekday: 'long' });
      // 2026-01-04 is a Sunday; walk seven days from the configured first column.
      return Array.from({ length: 7 }, (_, i) => {
        const day = new Date(2026, 0, 4 + this.weekStartsOn() + i);
        return { short: short.format(day).slice(0, 2), long: long.format(day) };
      });
    });
  }

  private initWeeks(): Signal<UiCalendarWeek[]> {
    return computed(() => {
      const focused = this.focusedDate();
      const first = new Date(focused.getFullYear(), focused.getMonth(), 1);
      const daysInMonth = new Date(focused.getFullYear(), focused.getMonth() + 1, 0).getDate();
      const lead = (first.getDay() - this.weekStartsOn() + 7) % 7;
      const count = Math.ceil((lead + daysInMonth) / 7);
      const label = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
      const todayKey = toLocalDateOnlyString(this.startOfToday());
      const gridOff = this.formDisabled();
      const selected = this.value();
      const selectedKey = selected ? toLocalDateOnlyString(selected) : null;
      const disabled = this.isDateDisabled();

      return Array.from({ length: count }, (_, w): UiCalendarWeek => {
        const days = Array.from({ length: 7 }, (_, d): UiCalendarDay => {
          const date = new Date(first.getFullYear(), first.getMonth(), 1 - lead + w * 7 + d);
          const key = toLocalDateOnlyString(date);
          const day: UiCalendarDay = {
            key,
            date,
            number: date.getDate(),
            label: label.format(date),
            outside: date.getMonth() !== first.getMonth(),
            today: key === todayKey,
            selected: key === selectedKey,
            disabled: disabled(date),
            classes: '',
          };
          day.classes = this.dayClasses(day, gridOff);
          return day;
        });
        return { key: days[0].key, days };
      });
    });
  }

  private focusActiveDay(): void {
    this.refocusing = true;
    afterNextRender(
      () => {
        this.host.nativeElement.querySelector<HTMLElement>(`[data-date="${this.focusedKey()}"]`)?.focus();
        this.refocusing = false;
      },
      { injector: this.injector }
    );
  }

  private dayClasses(day: UiCalendarDay, gridOff: boolean): string {
    // Exact px height; 14px root. The today dot is a 4px pseudo-element centred 5px above the bottom.
    const base =
      'relative h-[36px] w-full rounded-ui-sm label-14 tabular-nums transition-colors duration-ui-fast motion-reduce:transition-none focus-visible:shadow-focus focus-visible:outline-none';
    const dot = day.today
      ? "after:absolute after:bottom-[5px] after:left-1/2 after:-ml-[2px] after:h-[4px] after:w-[4px] after:rounded-ui-full after:content-['']"
      : '';
    if (day.selected) {
      // An unavailable selected date keeps its fill and gains the strike-through; the ink stays white to stay readable on the fill.
      const unavailable = day.disabled ? 'cursor-not-allowed line-through' : '';
      return `${base} ${dot} bg-ui-accent-500 text-white after:bg-white ${unavailable} ${gridOff ? 'cursor-not-allowed opacity-50' : ''}`;
    }
    if (day.disabled) return `${base} ${dot} cursor-not-allowed text-ui-neutral-400 line-through after:bg-ui-accent-500`;
    const tone = day.outside ? 'text-ui-neutral-500' : 'text-ui-neutral-900';
    const interaction = gridOff ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-ui-neutral-alpha-100';
    return `${base} ${dot} ${tone} ${interaction} after:bg-ui-accent-500`;
  }

  private startOfToday(): Date {
    return this.startOfDay(this.today() ?? new Date());
  }

  private startOfDay(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  private addDays(date: Date, days: number): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
  }

  /** Moves by whole months and keeps the day, clamped to the last day of a shorter month. */
  private addMonths(date: Date, months: number): Date {
    const target = new Date(date.getFullYear(), date.getMonth() + months, 1);
    const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    return new Date(target.getFullYear(), target.getMonth(), Math.min(date.getDate(), last));
  }
}
