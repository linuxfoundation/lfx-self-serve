// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input, model, viewChild } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { UiInputSize } from '@lfx-one/shared/interfaces';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UiOptionGroupComponent } from '../select/option-group.component';
import { UiOptionSeparatorComponent } from '../select/option-separator.component';
import { UiOptionComponent } from '../select/option.component';
import { UiMultiSelectComponent } from './multi-select.component';

interface TestOption {
  value: string;
  label: string;
  disabled?: boolean;
}

const OPTIONS: TestOption[] = [
  { value: 'prod', label: 'Production' },
  { value: 'preview', label: 'Preview' },
  { value: 'staging', label: 'Staging', disabled: true },
  { value: 'dev', label: 'Development' },
];

@Component({
  selector: 'lfx-ui-multi-select-test-host',
  imports: [UiMultiSelectComponent, UiOptionComponent, UiOptionGroupComponent, UiOptionSeparatorComponent, ReactiveFormsModule],
  templateUrl: './multi-select.component.spec.html',
})
class MultiSelectHostComponent {
  public readonly multiSelect = viewChild.required(UiMultiSelectComponent);
  /** Which composition the template renders. */
  public readonly mode = input<'basic' | 'groups' | 'form'>('basic');
  public readonly options = input<TestOption[]>(OPTIONS);
  public readonly values = model<string[]>([]);
  public readonly ariaLabel = input<string>('');
  public readonly size = input<UiInputSize>('medium');
  public readonly disabled = input<boolean>(false);
  public readonly control = new FormControl<string[]>(['preview'], { nonNullable: true });
}

const create = (mode: 'basic' | 'groups' | 'form'): ComponentFixture<MultiSelectHostComponent> => {
  const created = TestBed.createComponent(MultiSelectHostComponent);
  created.componentRef.setInput('mode', mode);
  return created;
};

describe('UiMultiSelectComponent', () => {
  let fixture: ComponentFixture<MultiSelectHostComponent>;
  let host: HTMLElement;

  const trigger = (): HTMLElement => host.querySelector('[data-testid="ui-multi-select-trigger"]') as HTMLElement;
  const panel = (): HTMLElement | null => document.querySelector('[data-testid="ui-multi-select-group"]');
  const rows = (): HTMLElement[] => Array.from(document.querySelectorAll<HTMLElement>('[data-testid="ui-option"]'));
  const box = (index: number): HTMLInputElement => rows()[index].querySelector('input[type="checkbox"]') as HTMLInputElement;
  const only = (index: number): HTMLButtonElement | null => rows()[index].querySelector('[data-testid="ui-option-only"] button');
  const set = async (name: string, value: unknown): Promise<void> => {
    fixture.componentRef.setInput(name, value);
    await fixture.whenStable();
  };
  // Keys go to the focused element and bubble, as in a browser. Native defaults (Space on a checkbox, Tab) are not simulated.
  const press = async (key: string, init: KeyboardEventInit = {}, target: Element = document.activeElement ?? trigger()): Promise<KeyboardEvent> => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event);
    await fixture.whenStable();
    return event;
  };
  const open = async (): Promise<void> => {
    trigger().click();
    await fixture.whenStable();
  };
  const values = (): string[] => fixture.componentInstance.values();

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [MultiSelectHostComponent] }).compileComponents();
    fixture = create('basic');
    host = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is a disclosure button named by its label', () => {
    expect(trigger().tagName).toBe('BUTTON');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(trigger().getAttribute('aria-label')).toBe('Environments');
    expect(trigger().getAttribute('role')).toBeNull();
    expect(trigger().tabIndex).toBe(0);
  });

  it('shows the field name, and a count once something is picked', async () => {
    expect(host.querySelector('[data-testid="ui-multi-select-value"]')?.textContent).toContain('Environments');
    expect(host.querySelector('[data-testid="ui-multi-select-count"]')).toBeNull();

    await set('values', ['prod', 'dev']);

    expect(host.querySelector('[data-testid="ui-multi-select-count"]')?.textContent?.trim()).toBe('2');
    expect(trigger().getAttribute('aria-label')).toBe('Environments, 2 selected');
  });

  it('opens a labelled group of rows on click and links the trigger to it', async () => {
    await open();

    expect(panel()?.getAttribute('role')).toBe('group');
    expect(panel()?.getAttribute('aria-label')).toBe('Environments');
    expect(rows().length).toBe(OPTIONS.length);
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(trigger().getAttribute('aria-controls')).toBe(panel()?.id);
  });

  it('gives each row a labelled checkbox and an Only button instead of listbox semantics', async () => {
    await set('values', ['preview']);
    await open();

    expect(rows().every((row) => row.getAttribute('role') === null && row.getAttribute('aria-selected') === null)).toBe(true);
    expect(box(0).getAttribute('aria-label')).toBe('Production');
    expect(rows().map((_, index) => box(index).checked)).toEqual([false, true, false, false]);
    expect(only(1)?.getAttribute('aria-label')).toBe('Only Preview');
    expect(only(1)?.textContent?.trim()).toBe('Only');
    // Faded, not visibility:hidden, so the arrow keys can focus it on a row that is not shown as active.
    expect(only(0)?.closest('[data-ui-option-action]')?.className).toContain('opacity-0');
    // Faded and not tappable until the row is hovered or has focus.
    expect(only(0)?.closest('[data-ui-option-action]')?.className).toContain('pointer-events-none');
    expect(only(0)?.closest('[data-ui-option-action]')?.className).toContain('group-hover:pointer-events-auto');
    expect(only(0)?.closest('[data-ui-option-action]')?.className).toContain('group-focus-within:pointer-events-auto');
  });

  it('moves focus into the list when it opens, to the first picked row or the first that can be picked', async () => {
    await open();
    expect(document.activeElement).toBe(box(0));
    await press('Escape');

    await set('values', ['dev']);
    await open();
    expect(document.activeElement).toBe(box(3));
  });

  it('toggles a row from its checkbox, its label area or Enter, keeping the list open and focus inside', async () => {
    await open();
    box(0).click();
    (rows()[3].querySelector('[data-testid="ui-option-content"]') as HTMLElement).click();
    await fixture.whenStable();

    expect(values()).toEqual(['prod', 'dev']);
    expect(box(0).checked).toBe(true);
    expect(panel()).not.toBeNull();
    expect(panel()?.contains(document.activeElement)).toBe(true);

    box(0).click();
    await fixture.whenStable();
    expect(values()).toEqual(['dev']);
  });

  it('leaves a disabled row without a clickable checkbox or an Only button', async () => {
    await open();
    rows()[2].click();
    await fixture.whenStable();

    expect(box(2).disabled).toBe(true);
    expect(only(2)).toBeNull();
    expect(values()).toEqual([]);
  });

  it('picks only one value with the Only button, without toggling the row', async () => {
    await set('values', ['prod', 'dev']);
    await open();
    only(1)?.click();
    await fixture.whenStable();

    expect(values()).toEqual(['preview']);
    expect(panel()).not.toBeNull();
  });

  it('opens from the trigger with Arrow Down and Arrow Up, focusing a row without picking', async () => {
    for (const key of ['ArrowDown', 'ArrowUp']) {
      const event = await press(key, {}, trigger());

      expect(panel(), key).not.toBeNull();
      expect(event.defaultPrevented, key).toBe(true);
      expect(document.activeElement, key).toBe(box(0));
      expect(values(), key).toEqual([]);

      await press('Escape');
    }
  });

  it('opens with Enter and Space as a button does, through its click', async () => {
    for (const key of ['Enter', ' ']) {
      const event = await press(key, {}, trigger());
      expect(event.defaultPrevented, key).toBe(false);
    }
    await open();
    expect(panel()).not.toBeNull();
  });

  it('moves between rows with the arrows, skipping a disabled row and not wrapping', async () => {
    await open();
    await press('ArrowUp');
    expect(document.activeElement).toBe(box(0));

    await press('ArrowDown');
    expect(document.activeElement).toBe(box(1));

    await press('ArrowDown');
    expect(document.activeElement).toBe(box(3));

    await press('ArrowDown');
    expect(document.activeElement).toBe(box(3));

    await press('Home');
    expect(document.activeElement).toBe(box(0));

    await press('End');
    expect(document.activeElement).toBe(box(3));
  });

  it('moves between a checkbox and its Only button with Arrow Right and Arrow Left', async () => {
    await open();
    await press('ArrowRight');
    expect(document.activeElement).toBe(only(0));

    await press('ArrowRight');
    expect(document.activeElement).toBe(only(0));

    await press('ArrowLeft');
    expect(document.activeElement).toBe(box(0));

    await press('ArrowLeft');
    expect(document.activeElement).toBe(box(0));
  });

  it('keeps the Only column with Arrow Up and Arrow Down, skipping the disabled row that has none', async () => {
    await open();
    await press('ArrowRight');
    await press('ArrowDown');
    expect(document.activeElement).toBe(only(1));

    await press('ArrowDown');
    expect(document.activeElement).toBe(only(3));

    await press('End');
    expect(document.activeElement).toBe(only(3));
    await press('Home');
    expect(document.activeElement).toBe(only(0));
  });

  it('toggles the focused checkbox with Enter, ignores its repeats and leaves Space to the browser', async () => {
    await open();
    await press('Enter');
    expect(values()).toEqual(['prod']);
    expect(panel()).not.toBeNull();

    await press('Enter', { repeat: true });
    expect(values()).toEqual(['prod']);

    // Space on a checkbox is the browser's own click, so the handler must not swallow it.
    const space = await press(' ');
    expect(space.defaultPrevented).toBe(false);
    box(0).click();
    expect(values()).toEqual([]);
  });

  it('does not take Enter away from the Only button', async () => {
    await open();
    await press('ArrowRight');
    const event = await press('Enter');

    expect(event.defaultPrevented).toBe(false);
    expect(values()).toEqual([]);
  });

  it('closes with Escape, returns focus to the trigger, keeps the values and keeps the key from a parent', async () => {
    await open();
    await press('Enter');
    const event = await press('Escape');

    expect(panel()).toBeNull();
    expect(values()).toEqual(['prod']);
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(trigger());
  });

  it('closes with Escape from the Only button too, and from the trigger while open', async () => {
    await open();
    await press('ArrowRight');
    await press('Escape');
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(trigger());

    await open();
    trigger().focus();
    await press('Escape');
    expect(panel()).toBeNull();
  });

  it('closes on Tab and Shift+Tab with focus back on the trigger, so the browser moves on from there', async () => {
    for (const shiftKey of [false, true]) {
      await open();
      const event = await press('Tab', { shiftKey });

      expect(event.defaultPrevented).toBe(false);
      expect(panel()).toBeNull();
      expect(document.activeElement).toBe(trigger());
      expect(values()).toEqual([]);
    }
  });

  it('closes and reports touched when focus moves to another control, and reports openChange', async () => {
    const touched = vi.fn();
    const emitted: boolean[] = [];
    const multiSelect = fixture.componentInstance.multiSelect();
    multiSelect.registerOnTouched(touched);
    multiSelect.openChange.subscribe((value) => emitted.push(value));
    await open();
    (host.querySelector('[data-testid="outside"]') as HTMLElement).focus();
    await fixture.whenStable();

    expect(panel()).toBeNull();
    expect(touched).toHaveBeenCalledTimes(1);
    expect(emitted).toEqual([true, false]);
  });

  it('stays open while focus moves between the trigger and the list', async () => {
    await open();
    trigger().focus();
    await fixture.whenStable();
    expect(panel()).not.toBeNull();

    await press('ArrowDown');
    expect(panel()).not.toBeNull();
    expect(document.activeElement).toBe(box(0));
  });

  it('closes on a click outside without taking focus, and toggles from the trigger', async () => {
    const outside = host.querySelector('[data-testid="outside"]') as HTMLElement;
    await open();
    outside.click();
    await fixture.whenStable();
    expect(panel()).toBeNull();

    await open();
    trigger().click();
    await fixture.whenStable();
    expect(panel()).toBeNull();
  });

  it('moves focus back into the list when the focused row is removed', async () => {
    await open();
    expect(document.activeElement).toBe(box(0));

    fixture.componentRef.setInput('options', OPTIONS.slice(1));
    await fixture.whenStable();
    // The removed row held focus, so it falls to the body. Browsers report that as a focusout without a target; the test environment does not.
    (document.activeElement as HTMLElement).blur();
    panel()?.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
    await fixture.whenStable();

    expect(panel()).not.toBeNull();
    expect(document.activeElement).toBe(box(0));
    expect(box(0).getAttribute('aria-label')).toBe('Preview');
  });

  it('shows the field name and count in a tooltip on the trigger, not a native title, and hides it while open', async () => {
    await set('values', ['prod']);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const tooltip = (): HTMLElement | null => document.querySelector('[data-testid="ui-tooltip"]');

    expect(host.querySelector('[title]')).toBeNull();
    trigger().dispatchEvent(Object.assign(new Event('pointerenter'), { pointerType: 'mouse' }));
    await vi.advanceTimersByTimeAsync(400);
    fixture.detectChanges();
    expect(tooltip()?.textContent?.trim()).toBe('Environments, 1 selected');

    vi.useRealTimers();
  });

  it('gives the overlay pane the panel radius so a corner click is not a click on the pane', async () => {
    await open();

    expect(document.querySelector('.cdk-overlay-pane')?.classList.contains('rounded-ui-md')).toBe(true);
  });

  it('reports touched when the trigger loses focus while closed', async () => {
    const touched = vi.fn();
    fixture.componentInstance.multiSelect().registerOnTouched(touched);
    trigger().focus();
    trigger().blur();

    expect(touched).toHaveBeenCalledTimes(1);
  });

  it('uses ariaLabel when there is no label', async () => {
    const bare = TestBed.createComponent(UiMultiSelectComponent);
    bare.componentRef.setInput('ariaLabel', 'Regions');
    await bare.whenStable();

    expect((bare.nativeElement as HTMLElement).querySelector('button')?.getAttribute('aria-label')).toBe('Regions');
  });

  it('sizes the trigger by the size input and keeps a forced-colors border', async () => {
    expect(trigger().className).toContain('h-ui-medium');
    expect(trigger().className).toContain('forced-colors:border-[color:CanvasText]');

    await set('size', 'tiny');
    expect(trigger().className).toContain('h-ui-tiny');
    expect(trigger().className).toContain('label-12');
  });

  it('is out of the tab order and ignores the pointer when disabled, and closes if disabled while open', async () => {
    await open();
    await set('disabled', true);
    expect(panel()).toBeNull();

    // Re-enabling must not bring the list back by itself.
    await set('disabled', false);
    expect(panel()).toBeNull();
    expect(trigger().getAttribute('aria-expanded')).toBe('false');

    await set('disabled', true);
    await open();

    expect((trigger() as HTMLButtonElement).disabled).toBe(true);
    expect(panel()).toBeNull();
  });

  it('gives each instance its own ids', () => {
    const other = create('basic');
    other.detectChanges();

    expect((other.nativeElement as HTMLElement).querySelector('button')?.id).not.toBe(trigger().id);
  });

  describe('with groups and rich rows', () => {
    let groupsFixture: ComponentFixture<MultiSelectHostComponent>;

    beforeEach(async () => {
      groupsFixture = create('groups');
      await groupsFixture.whenStable();
      ((groupsFixture.nativeElement as HTMLElement).querySelector('button') as HTMLElement).click();
      await groupsFixture.whenStable();
    });

    it('renders groups and projected content as in the select', () => {
      expect(Array.from(document.querySelectorAll('[role="group"]')).length).toBe(2);
      expect(document.querySelector('[data-testid="rich-row"]')?.textContent).toBe('Tokyo, Japan');
      expect(document.querySelectorAll('input[type="checkbox"]').length).toBe(3);
    });

    it('moves between rows across a group and a separator', async () => {
      const boxes = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
      expect(document.activeElement).toBe(boxes[0]);

      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));

      expect(document.activeElement).toBe(boxes[2]);
    });
  });

  describe('with a reactive form control', () => {
    let formFixture: ComponentFixture<MultiSelectHostComponent>;

    const formTrigger = (): HTMLElement => (formFixture.nativeElement as HTMLElement).querySelector('button') as HTMLElement;

    beforeEach(async () => {
      formFixture = create('form');
      await formFixture.whenStable();
    });

    it('writes the control value into the field', () => {
      expect(formTrigger().getAttribute('aria-label')).toBe('Environments, 1 selected');
    });

    it('updates the control with a string[] from a pick and marks it touched once focus leaves', async () => {
      formTrigger().focus();
      formTrigger().click();
      await formFixture.whenStable();
      document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[3].click();
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      await formFixture.whenStable();
      expect(formFixture.componentInstance.control.touched).toBe(false);

      formTrigger().blur();
      await formFixture.whenStable();

      expect(formFixture.componentInstance.control.value).toEqual(['preview', 'dev']);
      expect(formFixture.componentInstance.control.touched).toBe(true);
      expect(formFixture.componentInstance.control.dirty).toBe(true);
    });

    it('follows control.setValue(), control.disable() and reset()', async () => {
      formFixture.componentInstance.control.setValue(['prod', 'dev']);
      formFixture.componentInstance.control.disable();
      await formFixture.whenStable();
      expect(formTrigger().getAttribute('aria-label')).toBe('Environments, 2 selected');
      expect((formTrigger() as HTMLButtonElement).disabled).toBe(true);

      formFixture.componentInstance.control.enable();
      formFixture.componentInstance.control.reset([]);
      await formFixture.whenStable();
      expect(formTrigger().getAttribute('aria-label')).toBe('Environments');
    });
  });
});
