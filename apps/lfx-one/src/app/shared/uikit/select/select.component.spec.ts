// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { UiOption } from '@lfx-one/shared/interfaces';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UiSelectComponent } from './select.component';

const OPTIONS: UiOption[] = [
  { value: 'cncf', label: 'Cloud Native Computing Foundation' },
  { value: 'openssf', label: 'OpenSSF' },
  { value: 'lfai', label: 'LF AI & Data', disabled: true },
  { value: 'lfe', label: 'LF Energy', icon: 'fa-light fa-bolt' },
  { value: 'lfn', label: 'LF Networking' },
];

@Component({
  selector: 'lfx-ui-select-test-host',
  imports: [UiSelectComponent, ReactiveFormsModule],
  template: `<lfx-ui-select label="Foundation" [options]="options" [formControl]="control" />`,
})
class FormHostComponent {
  public readonly options = OPTIONS;
  public readonly control = new FormControl<string | null>('openssf');
}

// CDK's key manager reads `keyCode`, so the synthetic events carry it.
const KEY_CODES: Record<string, number> = {
  ArrowDown: 40,
  ArrowUp: 38,
  Home: 36,
  End: 35,
  PageDown: 34,
  PageUp: 33,
  Escape: 27,
  Enter: 13,
  Tab: 9,
  ' ': 32,
  o: 79,
  l: 76,
};

describe('UiSelectComponent', () => {
  let fixture: ComponentFixture<UiSelectComponent>;
  let host: HTMLElement;

  const trigger = (): HTMLElement => host.querySelector('[data-testid="ui-select-trigger"]') as HTMLElement;
  const listbox = (): HTMLElement | null => document.querySelector('[data-testid="ui-select-listbox"]');
  const optionEls = (): HTMLElement[] => Array.from(document.querySelectorAll<HTMLElement>('[data-testid="ui-select-option"]'));
  const set = async (name: string, value: unknown): Promise<void> => {
    fixture.componentRef.setInput(name, value);
    await fixture.whenStable();
  };
  const press = async (key: string, init: KeyboardEventInit = {}): Promise<KeyboardEvent> => {
    const event = new KeyboardEvent('keydown', { key, keyCode: KEY_CODES[key] ?? key.toUpperCase().charCodeAt(0), bubbles: true, cancelable: true, ...init });
    trigger().dispatchEvent(event);
    await fixture.whenStable();
    return event;
  };
  const open = async (): Promise<void> => {
    trigger().click();
    await fixture.whenStable();
  };
  const activeId = (): string | null => trigger().getAttribute('aria-activedescendant');
  const activeLabel = (): string | undefined =>
    optionEls()
      .find((el) => el.id === activeId())
      ?.textContent?.trim();

  beforeEach(async () => {
    // jsdom has no layout, so it has no scrollIntoView either.
    Element.prototype.scrollIntoView = vi.fn();
    await TestBed.configureTestingModule({ imports: [UiSelectComponent, FormHostComponent] }).compileComponents();
    fixture = TestBed.createComponent(UiSelectComponent);
    host = fixture.nativeElement as HTMLElement;
    fixture.componentRef.setInput('label', 'Foundation');
    fixture.componentRef.setInput('options', OPTIONS);
    fixture.componentRef.setInput('placeholder', 'Pick a foundation');
    await fixture.whenStable();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('is a select-only combobox named by its label', () => {
    const label = host.querySelector('[data-testid="ui-select-label"]') as HTMLElement;

    expect(trigger().getAttribute('role')).toBe('combobox');
    expect(trigger().getAttribute('aria-haspopup')).toBe('listbox');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(trigger().getAttribute('aria-controls')).toBeNull();
    expect(trigger().getAttribute('aria-labelledby')).toBe(label.id);
    expect(trigger().tabIndex).toBe(0);
  });

  it('uses ariaLabel when there is no visible label', async () => {
    await set('label', '');
    await set('ariaLabel', 'Foundation');

    expect(host.querySelector('[data-testid="ui-select-label"]')).toBeNull();
    expect(trigger().getAttribute('aria-label')).toBe('Foundation');
    expect(trigger().getAttribute('aria-labelledby')).toBeNull();
  });

  it('focuses the trigger when the label is clicked', () => {
    (host.querySelector('[data-testid="ui-select-label"]') as HTMLElement).click();

    expect(document.activeElement).toBe(trigger());
  });

  it('shows the placeholder until something is picked, then the label of the option', async () => {
    expect(host.querySelector('[data-testid="ui-select-placeholder"]')?.textContent).toContain('Pick a foundation');

    await set('value', 'openssf');

    expect(host.querySelector('[data-testid="ui-select-placeholder"]')).toBeNull();
    expect(host.querySelector('[data-testid="ui-select-value"]')?.textContent).toContain('OpenSSF');
  });

  it('falls back to the placeholder for a value that is not an option', async () => {
    await set('value', 'nope');

    expect(host.querySelector('[data-testid="ui-select-placeholder"]')).not.toBeNull();
  });

  it('opens on click and links the trigger to the listbox', async () => {
    await open();

    expect(listbox()?.getAttribute('role')).toBe('listbox');
    expect(optionEls().length).toBe(OPTIONS.length);
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(trigger().getAttribute('aria-controls')).toBe(listbox()?.id);
  });

  it('closes when the trigger is clicked again', async () => {
    await open();
    await open();

    expect(listbox()).toBeNull();
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
  });

  it('marks the chosen option and opens with it highlighted', async () => {
    await set('value', 'lfe');
    await open();

    expect(optionEls()[3].getAttribute('aria-selected')).toBe('true');
    expect(optionEls()[0].getAttribute('aria-selected')).toBe('false');
    expect(activeLabel()).toBe('LF Energy');
    expect(optionEls()[3].hasAttribute('data-highlighted')).toBe(true);
  });

  it('opens on the first option when nothing is chosen', async () => {
    await open();

    expect(activeLabel()).toBe('Cloud Native Computing Foundation');
  });

  it('opens with Arrow Down, Arrow Up, Enter and Space without picking', async () => {
    for (const key of ['ArrowDown', 'ArrowUp', 'Enter', ' ']) {
      const event = await press(key);

      expect(listbox(), key).not.toBeNull();
      expect(event.defaultPrevented, key).toBe(true);
      expect(fixture.componentInstance.value(), key).toBeNull();

      await press('Escape');
      expect(listbox(), key).toBeNull();
    }
  });

  it('moves the highlight with the arrows, skipping a disabled option and not wrapping', async () => {
    await press('ArrowDown');
    await press('ArrowDown');
    expect(activeLabel()).toBe('OpenSSF');

    await press('ArrowDown');
    expect(activeLabel()).toBe('LF Energy');

    await press('ArrowDown');
    await press('ArrowDown');
    expect(activeLabel()).toBe('LF Networking');

    await press('ArrowUp');
    expect(activeLabel()).toBe('LF Energy');
  });

  it('jumps to the first and last pickable option with Home and End', async () => {
    await press('ArrowDown');
    await press('End');
    expect(activeLabel()).toBe('LF Networking');

    await press('Home');
    expect(activeLabel()).toBe('Cloud Native Computing Foundation');
  });

  it('opens on the last option with End from the closed trigger', async () => {
    await press('End');

    expect(listbox()).not.toBeNull();
    expect(activeLabel()).toBe('LF Networking');
  });

  it('picks the highlighted option with Enter and closes', async () => {
    await press('ArrowDown');
    await press('ArrowDown');
    await press('Enter');

    expect(fixture.componentInstance.value()).toBe('openssf');
    expect(listbox()).toBeNull();
    expect(host.querySelector('[data-testid="ui-select-value"]')?.textContent).toContain('OpenSSF');
  });

  it('picks the highlighted option with Space', async () => {
    await press('ArrowDown');
    await press('End');
    await press(' ');

    expect(fixture.componentInstance.value()).toBe('lfn');
  });

  it('picks with Alt+Arrow Up', async () => {
    await press('ArrowDown');
    await press('End');
    await press('ArrowUp', { altKey: true });

    expect(fixture.componentInstance.value()).toBe('lfn');
    expect(listbox()).toBeNull();
  });

  it('closes with Escape without picking, and stops the key reaching a parent', async () => {
    await press('ArrowDown');
    await press('End');
    const event = await press('Escape');

    expect(listbox()).toBeNull();
    expect(fixture.componentInstance.value()).toBeNull();
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement === trigger() || document.activeElement === document.body).toBe(true);
  });

  it('picks on Tab and lets the key through', async () => {
    await press('ArrowDown');
    await press('End');
    const event = await press('Tab');

    expect(fixture.componentInstance.value()).toBe('lfn');
    expect(listbox()).toBeNull();
    expect(event.defaultPrevented).toBe(false);
  });

  // Virtual time: whenStable would wait on the faked timers, so these tests flush change detection by hand.
  const typeSync = (key: string): void => {
    trigger().dispatchEvent(new KeyboardEvent('keydown', { key, keyCode: KEY_CODES[key], bubbles: true, cancelable: true }));
    fixture.detectChanges();
  };

  it('jumps to an option by typing its label, and resets after half a second', async () => {
    await press('ArrowDown');
    vi.useFakeTimers();
    typeSync('o');
    expect(activeLabel()).toBe('OpenSSF');

    vi.advanceTimersByTime(600);
    typeSync('l');
    expect(activeLabel()).toBe('LF Energy');

    // Within half a second the letters add up to a word, and Space is part of it.
    typeSync('f');
    typeSync(' ');
    typeSync('n');
    expect(activeLabel()).toBe('LF Networking');
  });

  it('cycles through the options that start with a repeated letter', async () => {
    await press('ArrowDown');
    vi.useFakeTimers();
    typeSync('l');
    expect(activeLabel()).toBe('LF Energy');

    typeSync('l');
    expect(activeLabel()).toBe('LF Networking');

    typeSync('l');
    expect(activeLabel()).toBe('LF Energy');
  });

  it('opens the list from the closed trigger when a character is typed', async () => {
    await press('o');

    expect(listbox()).not.toBeNull();
    expect(activeLabel()).toBe('OpenSSF');
  });

  it('does not treat Space as a pick while typing', async () => {
    await press('ArrowDown');
    vi.useFakeTimers();
    typeSync('l');
    typeSync(' ');

    expect(listbox()).not.toBeNull();
    expect(fixture.componentInstance.value()).toBeNull();
  });

  it('picks an option on click and keeps focus on the trigger', async () => {
    trigger().focus();
    await open();
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    optionEls()[3].dispatchEvent(down);
    optionEls()[3].click();
    await fixture.whenStable();

    expect(down.defaultPrevented).toBe(true);
    expect(fixture.componentInstance.value()).toBe('lfe');
    expect(listbox()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it('ignores a click on a disabled option', async () => {
    await open();
    optionEls()[2].click();
    await fixture.whenStable();

    expect(optionEls()[2].getAttribute('aria-disabled')).toBe('true');
    expect(fixture.componentInstance.value()).toBeNull();
    expect(listbox()).not.toBeNull();
  });

  it('highlights the option under the pointer, but not a disabled one', async () => {
    await open();
    optionEls()[4].dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    await fixture.whenStable();
    expect(activeLabel()).toBe('LF Networking');

    optionEls()[2].dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    await fixture.whenStable();
    expect(activeLabel()).toBe('LF Networking');
  });

  it('closes and reports touched when focus leaves', async () => {
    const touched = vi.fn();
    fixture.componentInstance.registerOnTouched(touched);
    trigger().focus();
    await open();
    trigger().dispatchEvent(new FocusEvent('blur'));
    await fixture.whenStable();

    expect(listbox()).toBeNull();
    expect(touched).toHaveBeenCalledTimes(1);
    expect(fixture.componentInstance.value()).toBeNull();
  });

  it('shows the icon of an option, and the picked option replaces the prefix icon', async () => {
    await set('prefixIcon', 'fa-light fa-globe');
    expect(host.querySelector('[data-testid="ui-select-icon"] i')?.className).toContain('fa-globe');

    await set('value', 'lfe');
    expect(host.querySelector('[data-testid="ui-select-icon"] i')?.className).toContain('fa-bolt');

    await open();
    expect(optionEls()[3].querySelector('i')?.className).toContain('fa-bolt');
  });

  it('describes the field with the hint', async () => {
    await set('hint', 'Pick the foundation that hosts the project');
    const hint = host.querySelector('[data-testid="ui-select-hint"]') as HTMLElement;

    expect(trigger().getAttribute('aria-describedby')).toBe(hint.id);
    expect(trigger().getAttribute('aria-invalid')).toBeNull();
  });

  it('shows the error instead of the hint, marks the field invalid and describes it', async () => {
    await set('hint', 'Pick the foundation that hosts the project');
    await set('error', 'Choose a foundation to continue.');
    const error = host.querySelector('[data-testid="ui-select-error"]') as HTMLElement;

    expect(host.querySelector('[data-testid="ui-select-hint"]')).toBeNull();
    expect(error.getAttribute('role')).toBe('alert');
    expect(trigger().getAttribute('aria-invalid')).toBe('true');
    expect(trigger().getAttribute('aria-describedby')).toBe(error.id);
  });

  it('marks required for assistive technology', async () => {
    await set('required', true);

    expect(trigger().getAttribute('aria-required')).toBe('true');
  });

  it('keeps a visible border and focus outline in forced-colors mode', async () => {
    expect(trigger().className).toContain('forced-colors:border-[color:CanvasText]');
    expect(trigger().className).toContain('forced-colors:focus-visible:outline-[color:Highlight]');

    await set('disabled', true);
    expect(trigger().className).toContain('forced-colors:border-[color:GrayText]');
  });

  it('sizes the trigger by the size input', async () => {
    expect(trigger().className).toContain('h-ui-medium');

    await set('size', 'small');
    expect(trigger().className).toContain('h-ui-small');

    await set('size', 'tiny');
    expect(trigger().className).toContain('h-ui-tiny');
    expect(trigger().className).toContain('label-12');
  });

  it('is out of the tab order, ignores the keyboard and the pointer, and drops the hover ring when disabled', async () => {
    expect(trigger().className).toContain('edge-hover');

    await set('disabled', true);
    await press('ArrowDown');
    await open();

    expect(trigger().tabIndex).toBe(-1);
    expect(trigger().getAttribute('aria-disabled')).toBe('true');
    expect(trigger().className).not.toContain('edge-hover');
    expect(listbox()).toBeNull();
  });

  it('gives each instance its own ids', () => {
    const other = TestBed.createComponent(UiSelectComponent);
    other.detectChanges();

    expect((other.nativeElement as HTMLElement).querySelector('[role="combobox"]')?.id).not.toBe(trigger().id);
  });

  describe('with a reactive form control', () => {
    let formFixture: ComponentFixture<FormHostComponent>;

    beforeEach(async () => {
      formFixture = TestBed.createComponent(FormHostComponent);
      await formFixture.whenStable();
    });

    const formTrigger = (): HTMLElement => (formFixture.nativeElement as HTMLElement).querySelector('[role="combobox"]') as HTMLElement;

    it('writes the control value into the field', () => {
      expect(formTrigger().textContent).toContain('OpenSSF');
    });

    it('updates the control from a pick and marks it touched on blur', async () => {
      formTrigger().click();
      await formFixture.whenStable();
      document.querySelectorAll<HTMLElement>('[role="option"]')[4].click();
      formTrigger().dispatchEvent(new FocusEvent('blur'));
      await formFixture.whenStable();

      expect(formFixture.componentInstance.control.value).toBe('lfn');
      expect(formFixture.componentInstance.control.touched).toBe(true);
    });

    it('follows control.setValue() and control.disable()', async () => {
      formFixture.componentInstance.control.setValue('lfe');
      formFixture.componentInstance.control.disable();
      await formFixture.whenStable();

      expect(formTrigger().textContent).toContain('LF Energy');
      expect(formTrigger().getAttribute('aria-disabled')).toBe('true');
    });

    it('accepts null from reset()', async () => {
      formFixture.componentInstance.control.reset();
      await formFixture.whenStable();

      expect(formTrigger().textContent).not.toContain('OpenSSF');
    });
  });
});
