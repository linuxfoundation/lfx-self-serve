// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UiCalendarComponent } from './calendar.component';

@Component({
  selector: 'lfx-ui-calendar-test-host',
  imports: [UiCalendarComponent, ReactiveFormsModule],
  template: `<lfx-ui-calendar [formControl]="control" />`,
})
class FormHostComponent {
  public readonly control = new FormControl<Date | null>(new Date(2026, 9, 12));
}

describe('UiCalendarComponent', () => {
  let fixture: ComponentFixture<UiCalendarComponent>;
  let host: HTMLElement;

  const days = (): HTMLButtonElement[] => Array.from(host.querySelectorAll<HTMLButtonElement>('[data-testid="ui-calendar-day"]'));
  const day = (key: string): HTMLButtonElement => host.querySelector(`[data-date="${key}"]`) as HTMLButtonElement;
  const title = (): string => host.querySelector('[data-testid="ui-calendar-title"]')?.textContent?.trim() ?? '';
  const press = async (key: string, init: KeyboardEventInit = {}): Promise<void> => {
    (host.querySelector('[tabindex="0"]') as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }));
    await fixture.whenStable();
  };
  const set = async (name: string, value: unknown): Promise<void> => {
    fixture.componentRef.setInput(name, value);
    await fixture.whenStable();
  };

  beforeEach(async () => {
    // Pin "today" to Thursday 29 Oct 2026; only Date is faked so change detection still runs.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 29, 15, 30));
    await TestBed.configureTestingModule({ imports: [UiCalendarComponent, FormHostComponent] }).compileComponents();
    fixture = TestBed.createComponent(UiCalendarComponent);
    host = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the month of today as a labelled grid', () => {
    expect(title()).toBe('October 2026');
    expect(host.querySelector('[role="grid"]')?.getAttribute('aria-labelledby')).toBe(host.querySelector('[data-testid="ui-calendar-title"]')?.id);
    expect(host.querySelectorAll('[role="columnheader"]').length).toBe(7);
  });

  it('starts the week on Sunday and can start it on Monday', async () => {
    expect(host.querySelector('[role="columnheader"]')?.getAttribute('aria-label')).toBe('Sunday');
    // 1 Oct 2026 is a Thursday, so the Sunday-first grid opens on Sun 27 Sep.
    expect(days()[0].dataset['date']).toBe('2026-09-27');

    await set('weekStartsOn', 1);

    expect(host.querySelector('[role="columnheader"]')?.getAttribute('aria-label')).toBe('Monday');
    expect(days()[0].dataset['date']).toBe('2026-09-28');
  });

  it('marks today with aria-current and gives each day a full date label', () => {
    expect(day('2026-10-29').getAttribute('aria-current')).toBe('date');
    expect(day('2026-10-29').getAttribute('aria-label')).toBe('Thursday, October 29, 2026');
    expect(host.querySelectorAll('[aria-current="date"]').length).toBe(1);
  });

  it('selects a day on click and reflects it with aria-selected', async () => {
    day('2026-10-12').click();
    await fixture.whenStable();

    expect(fixture.componentInstance.value()).toEqual(new Date(2026, 9, 12));
    expect(day('2026-10-12').parentElement?.getAttribute('aria-selected')).toBe('true');
    expect(day('2026-10-13').parentElement?.getAttribute('aria-selected')).toBe('false');
  });

  it('opens on the selected date month and keeps one tab stop on it', async () => {
    await set('value', new Date(2026, 4, 20));

    expect(title()).toBe('May 2026');
    expect(host.querySelectorAll('[tabindex="0"]').length).toBe(1);
    expect(day('2026-05-20').getAttribute('tabindex')).toBe('0');
  });

  it('moves focus by day and week with the arrow keys', async () => {
    await press('ArrowRight');
    expect(day('2026-10-30').getAttribute('tabindex')).toBe('0');
    await press('ArrowDown');
    expect(day('2026-11-06').getAttribute('tabindex')).toBe('0');
    expect(title()).toBe('November 2026');
    await press('ArrowLeft');
    await press('ArrowUp');
    expect(day('2026-10-29').getAttribute('tabindex')).toBe('0');
  });

  it('jumps to the start and end of the week with Home and End', async () => {
    await press('Home');
    expect(day('2026-10-25').getAttribute('tabindex')).toBe('0');
    await press('End');
    expect(day('2026-10-31').getAttribute('tabindex')).toBe('0');
  });

  it('changes month with Page Up and Page Down, clamping the day, and year with Shift', async () => {
    await set('value', new Date(2026, 0, 31));
    await press('PageDown');
    expect(day('2026-02-28').getAttribute('tabindex')).toBe('0');
    await press('PageUp');
    expect(title()).toBe('January 2026');
    await press('PageDown', { shiftKey: true });
    expect(title()).toBe('January 2027');
  });

  it('changes month with the previous and next buttons', async () => {
    const [previous, next] = Array.from(host.querySelectorAll<HTMLButtonElement>('lfx-ui-button button'));
    next.click();
    await fixture.whenStable();
    expect(title()).toBe('November 2026');
    previous.click();
    previous.click();
    await fixture.whenStable();
    expect(title()).toBe('September 2026');
  });

  it('ignores keys it does not handle', async () => {
    await press('a');

    expect(day('2026-10-29').getAttribute('tabindex')).toBe('0');
  });

  it('marks disabled dates, keeps them focusable and refuses to select them', async () => {
    await set('isDateDisabled', (date: Date) => date.getDay() === 0);
    const sunday = day('2026-10-25');

    expect(sunday.getAttribute('aria-disabled')).toBe('true');
    expect(day('2026-10-24').getAttribute('aria-disabled')).toBeNull();

    sunday.click();
    await fixture.whenStable();

    expect(fixture.componentInstance.value()).toBeNull();
    expect(sunday.getAttribute('tabindex')).toBe('0');
  });

  describe('with a reactive form control', () => {
    let formFixture: ComponentFixture<FormHostComponent>;
    const formDay = (key: string): HTMLButtonElement => (formFixture.nativeElement as HTMLElement).querySelector(`[data-date="${key}"]`) as HTMLButtonElement;

    beforeEach(async () => {
      formFixture = TestBed.createComponent(FormHostComponent);
      await formFixture.whenStable();
    });

    it('shows the control value as selected', () => {
      expect(formDay('2026-10-12').parentElement?.getAttribute('aria-selected')).toBe('true');
    });

    it('writes a clicked day to the control and marks it touched', async () => {
      formDay('2026-10-20').click();
      await formFixture.whenStable();

      expect(formFixture.componentInstance.control.value).toEqual(new Date(2026, 9, 20));
      expect(formFixture.componentInstance.control.touched).toBe(true);
    });

    it('does not select once the control is disabled', async () => {
      formFixture.componentInstance.control.disable();
      await formFixture.whenStable();
      formDay('2026-10-20').click();
      await formFixture.whenStable();

      expect(formFixture.componentInstance.control.value).toEqual(new Date(2026, 9, 12));
    });
  });
});
