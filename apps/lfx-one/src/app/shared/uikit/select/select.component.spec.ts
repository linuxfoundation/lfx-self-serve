// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { InteractivityChecker } from '@angular/cdk/a11y';
import { Component, computed, input, model, viewChild } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { UiInputSize } from '@lfx-one/shared/interfaces';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UiOptionGroupComponent } from './option-group.component';
import { UiOptionSeparatorComponent } from './option-separator.component';
import { UiOptionComponent } from './option.component';
import { UiSelectValueDirective } from './select-value.directive';
import { UiSelectComponent } from './select.component';

interface TestOption {
  value: string;
  label: string;
  disabled?: boolean;
  icon?: string;
}

const OPTIONS: TestOption[] = [
  { value: 'cncf', label: 'Cloud Native Computing Foundation' },
  { value: 'openssf', label: 'OpenSSF' },
  { value: 'lfai', label: 'LF AI & Data', disabled: true },
  { value: 'lfe', label: 'LF Energy', icon: 'fa-light fa-bolt' },
  { value: 'lfn', label: 'LF Networking' },
];

@Component({
  selector: 'lfx-ui-select-test-host',
  imports: [UiSelectComponent, UiOptionComponent, UiOptionGroupComponent, UiOptionSeparatorComponent, UiSelectValueDirective, ReactiveFormsModule],
  templateUrl: './select.component.spec.html',
})
class SelectHostComponent {
  public readonly select = viewChild.required(UiSelectComponent);
  /** Which composition the template renders. */
  public readonly mode = input<'basic' | 'rich' | 'slots' | 'skipped-field' | 'form'>('basic');
  public readonly options = input<TestOption[]>(OPTIONS);
  public readonly value = model<string | null>(null);
  public readonly ariaLabel = input<string>('');
  public readonly hint = input<string>('');
  public readonly error = input<string>('');
  public readonly size = input<UiInputSize>('medium');
  public readonly disabled = input<boolean>(false);
  public readonly required = input<boolean>(false);
  public readonly pill = input<boolean>(false);
  public readonly prefixIcon = input<string>('');
  public readonly query = model<string>('');
  public readonly projects = input<string[]>(['Kubernetes', 'Envoy', 'Sigstore']);
  public readonly noMatch = computed(() => !this.projects().some((name) => name.toLowerCase().includes(this.query().toLowerCase())));
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

const create = (mode: 'basic' | 'rich' | 'slots' | 'skipped-field' | 'form'): ComponentFixture<SelectHostComponent> => {
  const created = TestBed.createComponent(SelectHostComponent);
  created.componentRef.setInput('mode', mode);
  return created;
};

describe('UiSelectComponent', () => {
  let fixture: ComponentFixture<SelectHostComponent>;
  let host: HTMLElement;

  const trigger = (): HTMLElement => host.querySelector('[data-testid="ui-select-trigger"]') as HTMLElement;
  const listbox = (): HTMLElement | null => document.querySelector('[data-testid="ui-select-listbox"]');
  const optionEls = (): HTMLElement[] => Array.from(document.querySelectorAll<HTMLElement>('[data-testid="ui-option"]'));
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
    await TestBed.configureTestingModule({ imports: [SelectHostComponent] }).compileComponents();
    fixture = create('basic');
    host = fixture.nativeElement as HTMLElement;
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
    const bare = TestBed.createComponent(UiSelectComponent);
    bare.componentRef.setInput('ariaLabel', 'Foundation');
    await bare.whenStable();
    const bareTrigger = (bare.nativeElement as HTMLElement).querySelector('[role="combobox"]') as HTMLElement;

    expect((bare.nativeElement as HTMLElement).querySelector('[data-testid="ui-select-label"]')).toBeNull();
    expect(bareTrigger.getAttribute('aria-label')).toBe('Foundation');
    expect(bareTrigger.getAttribute('aria-labelledby')).toBeNull();
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
    expect(optionEls()[0].getAttribute('role')).toBe('option');
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(trigger().getAttribute('aria-controls')).toBe(listbox()?.id);
  });

  it('gives the overlay pane the panel radius so a corner click is not a click on the pane', async () => {
    await open();

    expect(document.querySelector('.cdk-overlay-pane')?.classList.contains('rounded-ui-md')).toBe(true);
  });

  it('closes when the trigger is clicked again', async () => {
    await open();
    await open();

    expect(listbox()).toBeNull();
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
  });

  it('follows the projected options as they change', async () => {
    await set('options', [{ value: 'a', label: 'Alpha' }]);
    await open();
    expect(optionEls().map((el) => el.textContent?.trim())).toEqual(['Alpha']);

    await set('options', [...OPTIONS, { value: 'a', label: 'Alpha' }]);
    expect(optionEls().length).toBe(OPTIONS.length + 1);
  });

  it('marks the chosen option and opens with it highlighted', async () => {
    await set('value', 'lfe');
    await open();

    expect(optionEls()[3].getAttribute('aria-selected')).toBe('true');
    expect(optionEls()[0].getAttribute('aria-selected')).toBe('false');
    expect(activeLabel()).toBe('LF Energy');
    expect(optionEls()[3].hasAttribute('data-highlighted')).toBe(true);
    expect(optionEls()[3].querySelector('[data-testid="ui-option-check"]')).not.toBeNull();
    expect(optionEls()[0].querySelector('[data-testid="ui-option-check"]')).toBeNull();
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
    fixture.componentInstance.select().registerOnTouched(touched);
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
    // aria-invalid and aria-describedby carry the error; a live region would read it twice.
    expect(error.getAttribute('role')).toBeNull();
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

  it('rounds the trigger fully as a pill', async () => {
    expect(trigger().className).not.toContain('rounded-ui-full');

    await set('pill', true);
    expect(trigger().className).toContain('rounded-ui-full');
    expect(trigger().className).toContain('px-[16px]');
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
    const other = create('basic');
    other.detectChanges();

    expect((other.nativeElement as HTMLElement).querySelector('[role="combobox"]')?.id).not.toBe(trigger().id);
  });

  describe('with rich options, groups and a value template', () => {
    let richFixture: ComponentFixture<SelectHostComponent>;

    const richTrigger = (): HTMLElement => (richFixture.nativeElement as HTMLElement).querySelector('[role="combobox"]') as HTMLElement;
    const richPress = async (key: string): Promise<void> => {
      richTrigger().dispatchEvent(new KeyboardEvent('keydown', { key, keyCode: KEY_CODES[key], bubbles: true, cancelable: true }));
      await richFixture.whenStable();
    };
    const richActive = (): string | undefined => document.getElementById(richTrigger().getAttribute('aria-activedescendant') ?? '')?.textContent?.trim();

    beforeEach(async () => {
      richFixture = create('rich');
      await richFixture.whenStable();
    });

    it('renders the projected content as the row, and the label when there is none', async () => {
      richTrigger().click();
      await richFixture.whenStable();

      expect(optionEls()[0].querySelector('[data-testid="rich-row"]')?.textContent).toContain('Maintainer');
      expect(optionEls()[2].textContent?.trim()).toBe('Sam Sample');
    });

    it('exposes each group as a role="group" named by its title, and hides separators', async () => {
      richTrigger().click();
      await richFixture.whenStable();
      const groups = Array.from(document.querySelectorAll<HTMLElement>('[role="group"]'));
      const title = (group: HTMLElement): string | undefined => document.getElementById(group.getAttribute('aria-labelledby') ?? '')?.textContent?.trim();

      expect(groups.map(title)).toEqual(['Team', 'Guests']);
      expect(groups.some((group) => group.classList.contains('hidden'))).toBe(false);
      expect(groups[0].querySelectorAll('[role="option"]').length).toBe(3);
      document.querySelectorAll('[data-testid="ui-option-separator"]').forEach((separator) => expect(separator.getAttribute('aria-hidden')).toBe('true'));
      expect(document.querySelectorAll('[data-testid="ui-option-separator"]').length).toBe(2);
    });

    it('keeps one arrow-key order across groups, skipping the disabled option', async () => {
      await richPress('ArrowDown');
      expect(richActive()).toContain('Riley Example');

      await richPress('ArrowDown');
      expect(richActive()).toBe('Sam Sample');

      await richPress('ArrowDown');
      expect(richActive()).toBe('Avery Test');

      await richPress('ArrowDown');
      expect(richActive()).toBe('Nobody');

      await richPress('Home');
      expect(richActive()).toContain('Riley Example');
    });

    it('types ahead over projected options by their label, not their content', async () => {
      await richPress('ArrowDown');
      richTrigger().dispatchEvent(new KeyboardEvent('keydown', { key: 'a', keyCode: 65, bubbles: true, cancelable: true }));
      await richFixture.whenStable();

      expect(richActive()).toBe('Avery Test');
    });

    it('picks a projected option and shows the value template for it', async () => {
      await richPress('ArrowDown');
      await richPress('ArrowDown');
      await richPress('Enter');

      expect(richFixture.componentInstance.value()).toBe('sam');
      expect((richFixture.nativeElement as HTMLElement).querySelector('[data-testid="custom-value"]')?.textContent).toContain('Owner: Sam Sample (sam)');
    });
  });

  describe('with prefix and header slots', () => {
    let slotsFixture: ComponentFixture<SelectHostComponent>;

    const slotsTrigger = (): HTMLElement => (slotsFixture.nativeElement as HTMLElement).querySelector('[role="combobox"]') as HTMLElement;
    const search = (): HTMLInputElement | null => document.querySelector<HTMLInputElement>('[data-testid="search"]');
    const rows = (): string[] => optionEls().map((el) => el.textContent?.trim() ?? '');
    const keydown = async (target: HTMLElement, key: string): Promise<KeyboardEvent> => {
      const event = new KeyboardEvent('keydown', { key, keyCode: KEY_CODES[key], bubbles: true, cancelable: true });
      target.dispatchEvent(event);
      await slotsFixture.whenStable();
      return event;
    };

    beforeEach(async () => {
      // jsdom has no layout, so every element reads as hidden to the CDK's focusable check.
      vi.spyOn(InteractivityChecker.prototype, 'isVisible').mockReturnValue(true);
      slotsFixture = create('slots');
      await slotsFixture.whenStable();
      slotsTrigger().focus();
    });

    it('only opens the list when a character is typed on the closed trigger, so typing starts in the field', async () => {
      const event = new KeyboardEvent('keydown', { key: 's', keyCode: 83, bubbles: true, cancelable: true });
      slotsTrigger().dispatchEvent(event);
      await slotsFixture.whenStable();

      expect(document.querySelector('[data-testid="ui-select-listbox"]')).not.toBeNull();
      expect(document.activeElement).toBe(search());
      expect(slotsTrigger().getAttribute('aria-activedescendant')).toBe(optionEls()[0].id);
    });

    it('shows prefix content inside the trigger, before the value', () => {
      const prefix = slotsTrigger().querySelector('[data-testid="prefix"]') as HTMLElement;

      expect(prefix).not.toBeNull();
      expect(slotsTrigger().firstElementChild).toBe(prefix);
    });

    it('puts the header content above the list and moves focus to its field on open', async () => {
      slotsTrigger().click();
      await slotsFixture.whenStable();

      expect(document.querySelector('[data-testid="ui-select-header"]')?.contains(search())).toBe(true);
      expect(document.querySelector('[data-testid="ui-select-listbox"]')?.contains(search())).toBe(false);
      expect(document.activeElement).toBe(search());
      expect(slotsTrigger().getAttribute('aria-expanded')).toBe('true');
    });

    it('lets the page filter the options from the search field', async () => {
      slotsTrigger().click();
      await slotsFixture.whenStable();
      (search() as HTMLInputElement).value = 'sig';
      search()?.dispatchEvent(new Event('input', { bubbles: true }));
      await slotsFixture.whenStable();

      expect(rows()).toEqual(['Sigstore']);
    });

    it('shows the projected empty message in a live region outside the listbox only while it is projected', async () => {
      slotsTrigger().click();
      await slotsFixture.whenStable();
      const status = document.querySelector('[data-testid="ui-select-empty"]') as HTMLElement;

      expect(status.getAttribute('role')).toBe('status');
      expect(status.className).toContain('empty:hidden');
      expect(status.textContent?.trim()).toBe('');
      expect(optionEls().length).toBe(3);

      (search() as HTMLInputElement).value = 'zzz';
      search()?.dispatchEvent(new Event('input', { bubbles: true }));
      await slotsFixture.whenStable();

      const message = document.querySelector('[data-testid="empty"]') as HTMLElement;
      expect(optionEls().length).toBe(0);
      expect(status.contains(message)).toBe(true);
      expect(document.querySelector('[data-testid="ui-select-listbox"]')?.contains(message)).toBe(false);
      expect(document.querySelector('[data-testid="ui-select-listbox"]')?.classList).toContain('hidden');
      expect(status.textContent?.trim()).toBe('No projects match');

      (search() as HTMLInputElement).value = 'env';
      search()?.dispatchEvent(new Event('input', { bubbles: true }));
      await slotsFixture.whenStable();

      expect(document.querySelector('[data-testid="empty"]')).toBeNull();
      expect(document.querySelector('[data-testid="ui-select-listbox"]')?.classList).not.toContain('hidden');
    });

    it('closes on Escape from the field and returns focus to the trigger', async () => {
      slotsTrigger().click();
      await slotsFixture.whenStable();
      const event = await keydown(search() as HTMLElement, 'Escape');

      expect(event.defaultPrevented).toBe(true);
      expect(document.querySelector('[data-testid="ui-select-listbox"]')).toBeNull();
      expect(document.activeElement).toBe(slotsTrigger());
    });

    it('hands focus back to the trigger on Arrow Down, keeping the list open', async () => {
      slotsTrigger().click();
      await slotsFixture.whenStable();
      await keydown(search() as HTMLElement, 'ArrowDown');

      expect(document.activeElement).toBe(slotsTrigger());
      expect(document.querySelector('[data-testid="ui-select-listbox"]')).not.toBeNull();
      expect(slotsTrigger().getAttribute('aria-activedescendant')).toBeTruthy();
    });

    it('stays open while focus moves between the trigger and the header, and closes when it leaves both', async () => {
      const touched = vi.fn();
      slotsFixture.componentInstance.select().registerOnTouched(touched);
      slotsTrigger().click();
      await slotsFixture.whenStable();

      slotsTrigger().dispatchEvent(new FocusEvent('blur', { relatedTarget: search() }));
      await slotsFixture.whenStable();
      expect(document.querySelector('[data-testid="ui-select-listbox"]')).not.toBeNull();
      expect(touched).not.toHaveBeenCalled();

      search()?.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: slotsTrigger() }));
      await slotsFixture.whenStable();
      expect(document.querySelector('[data-testid="ui-select-listbox"]')).not.toBeNull();

      search()?.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: document.querySelector('[data-testid="outside"]') }));
      await slotsFixture.whenStable();
      expect(document.querySelector('[data-testid="ui-select-listbox"]')).toBeNull();
      expect(touched).toHaveBeenCalledTimes(1);
    });

    it('lets the field take a click but keeps focus when the header padding is clicked', async () => {
      slotsTrigger().click();
      await slotsFixture.whenStable();
      const onField = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
      const onPadding = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
      search()?.dispatchEvent(onField);
      document.querySelector('[data-testid="ui-select-header"]')?.dispatchEvent(onPadding);

      expect(onField.defaultPrevented).toBe(false);
      expect(onPadding.defaultPrevented).toBe(true);
    });

    it('returns focus to the trigger after a pick made while focus is in the header', async () => {
      slotsTrigger().click();
      await slotsFixture.whenStable();
      optionEls()[1].click();
      await slotsFixture.whenStable();

      expect(slotsFixture.componentInstance.value()).toBe('envoy');
      expect(document.activeElement).toBe(slotsTrigger());
    });
  });

  describe('while the options change under an open list', () => {
    let filterFixture: ComponentFixture<SelectHostComponent>;

    const filterTrigger = (): HTMLElement => (filterFixture.nativeElement as HTMLElement).querySelector('[role="combobox"]') as HTMLElement;
    const filterPress = async (key: string): Promise<void> => {
      filterTrigger().dispatchEvent(new KeyboardEvent('keydown', { key, keyCode: KEY_CODES[key], bubbles: true, cancelable: true }));
      await filterFixture.whenStable();
    };

    beforeEach(async () => {
      filterFixture = create('slots');
      filterFixture.componentRef.setInput('projects', ['Kubernetes', 'Envoy', 'Sigstore', 'SLSA']);
      await filterFixture.whenStable();
      filterTrigger().focus();
    });

    it('keeps the trigger on the picked option while a filter hides its row', async () => {
      filterFixture.componentInstance.value.set('envoy');
      filterTrigger().click();
      await filterFixture.whenStable();
      filterFixture.componentRef.setInput('query', 'sig');
      await filterFixture.whenStable();

      expect(optionEls().map((el) => el.textContent?.trim())).toEqual(['Sigstore']);
      expect(filterTrigger().querySelector('[data-testid="ui-select-value"]')?.textContent).toContain('Envoy');
      expect(filterTrigger().querySelector('[data-testid="ui-select-placeholder"]')).toBeNull();
    });

    it('drops the kept option once the value changes to one that is not listed', async () => {
      filterFixture.componentInstance.value.set('envoy');
      filterFixture.componentRef.setInput('query', 'sig');
      await filterFixture.whenStable();
      filterFixture.componentInstance.value.set('gone');
      await filterFixture.whenStable();

      expect(filterTrigger().querySelector('[data-testid="ui-select-placeholder"]')).not.toBeNull();
    });

    it('keeps a highlight and picks with Enter after a filter removes the highlighted row', async () => {
      filterTrigger().click();
      await filterFixture.whenStable();
      await filterPress('End');
      expect(document.getElementById(filterTrigger().getAttribute('aria-activedescendant') ?? '')?.textContent?.trim()).toBe('SLSA');

      filterFixture.componentRef.setInput('query', 'sig');
      await filterFixture.whenStable();
      const active = document.getElementById(filterTrigger().getAttribute('aria-activedescendant') ?? '');
      expect(active?.textContent?.trim()).toBe('Sigstore');

      await filterPress('Enter');
      expect(filterFixture.componentInstance.value()).toBe('sigstore');
    });

    it('continues arrow navigation from the highlighted row after the list is filtered', async () => {
      filterTrigger().click();
      await filterFixture.whenStable();
      await filterPress('ArrowDown');
      expect(document.getElementById(filterTrigger().getAttribute('aria-activedescendant') ?? '')?.textContent?.trim()).toBe('Envoy');

      filterFixture.componentRef.setInput('query', 's');
      await filterFixture.whenStable();
      // Rows left: Kubernetes, Sigstore, SLSA. Envoy is gone, so the highlight falls back to the first row and the arrows go on from there.
      expect(document.getElementById(filterTrigger().getAttribute('aria-activedescendant') ?? '')?.textContent?.trim()).toBe('Kubernetes');
      await filterPress('ArrowDown');

      expect(document.getElementById(filterTrigger().getAttribute('aria-activedescendant') ?? '')?.textContent?.trim()).toBe('Sigstore');
    });
  });

  describe('edge cases', () => {
    it('ignores two different typed characters when every option is disabled', async () => {
      await set('options', [
        { value: 'a', label: 'Alpha', disabled: true },
        { value: 'b', label: 'Beta', disabled: true },
      ]);
      await open();
      vi.useFakeTimers();

      expect(() => {
        typeSync('a');
        typeSync('b');
      }).not.toThrow();
      expect(activeId()).toBeNull();
    });

    it('closes the list, and ignores the pending click, when the field is disabled while open', async () => {
      await open();
      const row = optionEls()[1];
      await set('disabled', true);
      row.click();
      await fixture.whenStable();

      expect(listbox()).toBeNull();
      expect(trigger().getAttribute('aria-expanded')).toBe('false');
      expect(fixture.componentInstance.value()).toBeNull();
    });

    it('does not report a change when Tab or Enter picks the row that is already chosen', async () => {
      await set('value', 'openssf');
      const changed = vi.fn();
      fixture.componentInstance.select().registerOnChange(changed);
      await open();
      await press('Tab');
      await open();
      await press('Enter');

      expect(changed).not.toHaveBeenCalled();
      expect(listbox()).toBeNull();
    });

    it('scrolls the list, and only the list, to the highlighted row when the fallback moves it', async () => {
      // jsdom has no layout: report the list as 0 to 100px and every row as 150 to 190px, below its bottom edge.
      const box = (top: number, bottom: number): DOMRect => ({
        top,
        bottom,
        left: 0,
        right: 0,
        width: 0,
        height: bottom - top,
        x: 0,
        y: top,
        toJSON: () => ({}),
      });
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
        return this.getAttribute('role') === 'listbox' ? box(0, 100) : box(150, 190);
      });
      await open();
      await press('ArrowDown');
      listbox()!.scrollTop = 0;
      // The highlighted row (OpenSSF) loses its place, so the highlight falls back to the first enabled row.
      await set(
        'options',
        OPTIONS.filter((option) => option.value !== 'openssf')
      );

      expect(activeLabel()).toBe('Cloud Native Computing Foundation');
      expect(listbox()?.scrollTop).toBe(90);
    });

    it('opens on the first row that starts with the typed character when nothing is picked', async () => {
      await set('options', [
        { value: 'a', label: 'Alpha' },
        { value: 'p', label: 'Alpine' },
        { value: 'b', label: 'Beta' },
      ]);
      await press('a');

      expect(activeLabel()).toBe('Alpha');
    });

    it('leaves Escape and Arrow Down alone while the header field is composing text', async () => {
      vi.spyOn(InteractivityChecker.prototype, 'isVisible').mockReturnValue(true);
      const slots = create('slots');
      await slots.whenStable();
      const slotsTrigger = (slots.nativeElement as HTMLElement).querySelector('[role="combobox"]') as HTMLElement;
      slotsTrigger.click();
      await slots.whenStable();
      const field = document.querySelector('[data-testid="search"]') as HTMLInputElement;
      const keys = ['ArrowDown', 'Escape'].map(
        (key) => new KeyboardEvent('keydown', { key, keyCode: KEY_CODES[key], isComposing: true, bubbles: true, cancelable: true })
      );
      keys.forEach((event) => field.dispatchEvent(event));
      await slots.whenStable();

      expect(keys.map((event) => event.defaultPrevented)).toEqual([false, false]);
      expect(document.activeElement).toBe(field);
      expect(document.querySelector('[data-testid="ui-select-listbox"]')).not.toBeNull();
    });

    it('keeps a disabled chosen value on Enter instead of picking the first enabled row', async () => {
      await set('value', 'lfai');
      await press('ArrowDown');

      expect(activeLabel()).toBe('LF AI & Data');
      await press('Enter');

      expect(fixture.componentInstance.value()).toBe('lfai');
    });

    it('does not pick on the repeats of a held Enter or Space', async () => {
      await press('Enter');
      await press('Enter', { repeat: true });
      await press(' ', { repeat: true });

      expect(listbox()).not.toBeNull();
      expect(fixture.componentInstance.value()).toBeNull();

      await press('Enter');
      expect(fixture.componentInstance.value()).toBe('cncf');
    });

    it('marks the highlighted row with an outline in forced-colors mode', async () => {
      await open();

      expect(optionEls()[0].className).toContain('forced-colors:data-[highlighted]:outline-[color:Highlight]');
    });

    it('focuses the first header field that can take focus, skipping a disabled one', async () => {
      vi.spyOn(InteractivityChecker.prototype, 'isVisible').mockReturnValue(true);
      const skipped = create('skipped-field');
      await skipped.whenStable();
      (skipped.nativeElement as HTMLElement).querySelector<HTMLElement>('[role="combobox"]')?.click();
      await skipped.whenStable();

      expect(document.activeElement).toBe(document.querySelector('[data-testid="search"]'));
    });
  });

  describe('openChange', () => {
    it('emits true when the list opens and false when it closes', async () => {
      const emitted: boolean[] = [];
      fixture.componentInstance.select().openChange.subscribe((open) => emitted.push(open));

      await open();
      await press('Escape');
      await open();
      await open();

      expect(emitted).toEqual([true, false, true, false]);
    });

    it('does not emit again for a close that changes nothing', async () => {
      const emitted: boolean[] = [];
      fixture.componentInstance.select().openChange.subscribe((open) => emitted.push(open));

      await press('Escape');
      fixture.componentInstance.select().setDisabledState(true);

      expect(emitted).toEqual([]);
    });
  });

  describe('Tab from a header field', () => {
    beforeEach(() => {
      // jsdom has no layout, so every element reads as hidden to the CDK's tabbable check.
      vi.spyOn(InteractivityChecker.prototype, 'isVisible').mockReturnValue(true);
    });

    const openWithHeader = async (): Promise<{ fixture: ComponentFixture<SelectHostComponent>; trigger: HTMLElement; field: HTMLInputElement }> => {
      const slots = create('slots');
      await slots.whenStable();
      const slotsTrigger = (slots.nativeElement as HTMLElement).querySelector('[role="combobox"]') as HTMLElement;
      slotsTrigger.focus();
      slotsTrigger.click();
      await slots.whenStable();
      return { fixture: slots, trigger: slotsTrigger, field: document.querySelector('[data-testid="search"]') as HTMLInputElement };
    };

    it('hands focus to the trigger and lets the Tab move on, without picking', async () => {
      const { fixture: slots, trigger: slotsTrigger, field } = await openWithHeader();
      const event = new KeyboardEvent('keydown', { key: 'Tab', keyCode: 9, bubbles: true, cancelable: true });
      field.dispatchEvent(event);
      await slots.whenStable();

      expect(document.activeElement).toBe(slotsTrigger);
      expect(event.defaultPrevented).toBe(false);
      expect(slots.componentInstance.value()).toBeNull();
    });

    it('closes the list and takes the header out of the tab order, so Tab cannot loop back into it', async () => {
      const { fixture: slots, field } = await openWithHeader();
      const header = document.querySelector('[data-testid="ui-select-header"]') as HTMLElement;
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', keyCode: 9, bubbles: true, cancelable: true }));
      await slots.whenStable();

      expect(header.inert).toBe(true);
      expect(document.querySelector('[data-testid="ui-select-listbox"]')).toBeNull();
    });

    it('closes the list from the trigger on Tab even when no row can be picked, and takes the header out of the tab order', async () => {
      const { fixture: slots, trigger: slotsTrigger, field } = await openWithHeader();
      const header = document.querySelector('[data-testid="ui-select-header"]') as HTMLElement;
      slots.componentRef.setInput('query', 'zzz');
      await slots.whenStable();
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', keyCode: 40, bubbles: true, cancelable: true }));
      slotsTrigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', keyCode: 9, bubbles: true, cancelable: true }));
      await slots.whenStable();

      expect(header.inert).toBe(true);
      expect(document.querySelector('[data-testid="ui-select-listbox"]')).toBeNull();
      expect(slots.componentInstance.value()).toBeNull();
    });

    it('stops on the trigger for Shift+Tab from the first field', async () => {
      const { fixture: slots, trigger: slotsTrigger, field } = await openWithHeader();
      const event = new KeyboardEvent('keydown', { key: 'Tab', keyCode: 9, shiftKey: true, bubbles: true, cancelable: true });
      field.dispatchEvent(event);
      await slots.whenStable();

      expect(document.activeElement).toBe(slotsTrigger);
      expect(event.defaultPrevented).toBe(true);
      expect(document.querySelector('[data-testid="ui-select-listbox"]')).not.toBeNull();
    });

    it('leaves Tab alone between two header fields', async () => {
      const { fixture: slots, trigger: slotsTrigger, field } = await openWithHeader();
      const second = document.createElement('input');
      field.after(second);
      const forward = new KeyboardEvent('keydown', { key: 'Tab', keyCode: 9, bubbles: true, cancelable: true });
      field.focus();
      field.dispatchEvent(forward);
      const backward = new KeyboardEvent('keydown', { key: 'Tab', keyCode: 9, shiftKey: true, bubbles: true, cancelable: true });
      second.focus();
      second.dispatchEvent(backward);
      await slots.whenStable();

      expect(document.activeElement).toBe(second);
      expect(document.activeElement).not.toBe(slotsTrigger);
      expect(forward.defaultPrevented).toBe(false);
      expect(backward.defaultPrevented).toBe(false);
    });
  });

  describe('with a reactive form control', () => {
    let formFixture: ComponentFixture<SelectHostComponent>;

    beforeEach(async () => {
      formFixture = create('form');
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
