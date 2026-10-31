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
import { UiComboboxComponent } from './combobox.component';

interface TestOption {
  value: string;
  label: string;
  disabled?: boolean;
}

const OPTIONS: TestOption[] = [
  { value: 'k8s', label: 'Kubernetes' },
  { value: 'keda', label: 'KEDA', disabled: true },
  { value: 'kubeedge', label: 'KubeEdge' },
  { value: 'envoy', label: 'Envoy' },
  { value: 'kubevirt', label: 'KubeVirt' },
];

@Component({
  selector: 'lfx-ui-combobox-test-host',
  imports: [UiComboboxComponent, UiOptionComponent, UiOptionGroupComponent, UiOptionSeparatorComponent, ReactiveFormsModule],
  templateUrl: './combobox.component.spec.html',
})
class ComboboxHostComponent {
  public readonly combobox = viewChild.required(UiComboboxComponent);
  /** Which composition the template renders. */
  public readonly mode = input<'basic' | 'groups' | 'form'>('basic');
  public readonly options = input<TestOption[]>(OPTIONS);
  public readonly value = model<string | null>(null);
  public readonly ariaLabel = input<string>('');
  public readonly hint = input<string>('');
  public readonly error = input<string>('');
  public readonly size = input<UiInputSize>('medium');
  public readonly disabled = input<boolean>(false);
  public readonly required = input<boolean>(false);
  public readonly control = new FormControl<string | null>('envoy');
}

// CDK's key manager reads `keyCode`, so the synthetic events carry it.
const KEY_CODES: Record<string, number> = { ArrowDown: 40, ArrowUp: 38, PageDown: 34, PageUp: 33, Escape: 27, Enter: 13, Tab: 9, Home: 36, End: 35 };

const create = (mode: 'basic' | 'groups' | 'form'): ComponentFixture<ComboboxHostComponent> => {
  const created = TestBed.createComponent(ComboboxHostComponent);
  created.componentRef.setInput('mode', mode);
  return created;
};

describe('UiComboboxComponent', () => {
  let fixture: ComponentFixture<ComboboxHostComponent>;
  let host: HTMLElement;

  const field = (): HTMLInputElement => host.querySelector('[data-testid="ui-combobox-input"]') as HTMLInputElement;
  const listbox = (): HTMLElement | null => document.querySelector('[data-testid="ui-combobox-listbox"]');
  const empty = (): HTMLElement | null => document.querySelector('[data-testid="ui-combobox-empty"]');
  const optionEls = (): HTMLElement[] => Array.from(document.querySelectorAll<HTMLElement>('[data-testid="ui-option"]'));
  const visibleRows = (): string[] =>
    optionEls()
      .filter((el) => !el.classList.contains('hidden'))
      .map((el) => el.textContent?.trim() ?? '');
  const set = async (name: string, value: unknown): Promise<void> => {
    fixture.componentRef.setInput(name, value);
    await fixture.whenStable();
  };
  const press = async (key: string, init: KeyboardEventInit = {}): Promise<KeyboardEvent> => {
    const event = new KeyboardEvent('keydown', { key, keyCode: KEY_CODES[key], bubbles: true, cancelable: true, ...init });
    field().dispatchEvent(event);
    await fixture.whenStable();
    return event;
  };
  const type = async (text: string): Promise<void> => {
    field().value = text;
    field().dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.whenStable();
  };
  const open = async (): Promise<void> => {
    field().focus();
    field().click();
    await fixture.whenStable();
  };
  const activeId = (): string | null => field().getAttribute('aria-activedescendant');
  const activeLabel = (): string | undefined =>
    optionEls()
      .find((el) => el.id === activeId())
      ?.textContent?.trim();

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ComboboxHostComponent] }).compileComponents();
    fixture = create('basic');
    host = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is a list-autocomplete combobox named by its label', () => {
    const label = host.querySelector('[data-testid="ui-combobox-label"]') as HTMLElement;

    expect(field().getAttribute('role')).toBe('combobox');
    expect(field().getAttribute('aria-autocomplete')).toBe('list');
    expect(field().getAttribute('aria-haspopup')).toBe('listbox');
    expect(field().getAttribute('aria-expanded')).toBe('false');
    expect(field().getAttribute('aria-controls')).toBeNull();
    expect(field().getAttribute('aria-labelledby')).toBe(label.id);
    expect(label.getAttribute('for')).toBe(field().id);
  });

  it('uses ariaLabel when there is no visible label', async () => {
    const bare = TestBed.createComponent(UiComboboxComponent);
    bare.componentRef.setInput('ariaLabel', 'Project');
    await bare.whenStable();
    const bareField = (bare.nativeElement as HTMLElement).querySelector('input') as HTMLInputElement;

    expect(bareField.getAttribute('aria-label')).toBe('Project');
    expect(bareField.getAttribute('aria-labelledby')).toBeNull();
  });

  it('shows the placeholder, then the label of the picked option', async () => {
    expect(field().placeholder).toBe('Search projects');
    expect(field().value).toBe('');

    await set('value', 'envoy');

    expect(field().value).toBe('Envoy');
  });

  it('opens on click and links the input to the listbox, without moving focus', async () => {
    await open();

    expect(listbox()?.getAttribute('role')).toBe('listbox');
    expect(optionEls().length).toBe(OPTIONS.length);
    expect(field().getAttribute('aria-expanded')).toBe('true');
    expect(field().getAttribute('aria-controls')).toBe(listbox()?.id);
    expect(document.activeElement).toBe(field());
  });

  it('gives the overlay pane the panel radius so a corner click is not a click on the pane', async () => {
    await open();

    expect(document.querySelector('.cdk-overlay-pane')?.classList.contains('rounded-ui-md')).toBe(true);
  });

  it('keeps focus in the input on a press outside the text, so the chevron can close the list', async () => {
    const chevron = host.querySelector('[data-testid="ui-combobox-chevron"]') as HTMLElement;
    const press = (target: HTMLElement): MouseEvent => {
      const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
      target.dispatchEvent(event);
      return event;
    };

    expect(press(chevron).defaultPrevented).toBe(true);
    expect(press(field()).defaultPrevented).toBe(false);
  });

  it('toggles from the chevron and reports openChange', async () => {
    const emitted: boolean[] = [];
    fixture.componentInstance.combobox().openChange.subscribe((value) => emitted.push(value));
    const chevron = host.querySelector('[data-testid="ui-combobox-chevron"]') as HTMLElement;
    chevron.click();
    await fixture.whenStable();
    expect(listbox()).not.toBeNull();

    chevron.click();
    await fixture.whenStable();

    expect(listbox()).toBeNull();
    expect(emitted).toEqual([true, false]);
  });

  it('opens with Arrow Down on the chosen row, and with Arrow Up', async () => {
    await set('value', 'kubeedge');
    await press('ArrowDown');
    expect(activeLabel()).toBe('KubeEdge');

    await press('Escape');
    await press('ArrowUp');
    expect(listbox()).not.toBeNull();
  });

  it('opens on the first row that can be picked when nothing is chosen', async () => {
    await press('ArrowDown');

    expect(activeLabel()).toBe('Kubernetes');
  });

  it('filters the rows as you type, ignoring case, and highlights the first match', async () => {
    await type('kube');

    expect(listbox()).not.toBeNull();
    expect(visibleRows()).toEqual(['Kubernetes', 'KubeEdge', 'KubeVirt']);
    expect(activeLabel()).toBe('Kubernetes');
    expect(field().getAttribute('aria-expanded')).toBe('true');
  });

  it('shows the typed part of a plain label in bold', async () => {
    await type('edge');
    const row = optionEls().find((el) => el.textContent?.includes('KubeEdge')) as HTMLElement;

    expect(row.querySelector('strong')?.textContent).toBe('Edge');
    expect(row.textContent?.trim()).toBe('KubeEdge');
  });

  it('moves through the matching rows only, skipping a disabled one, without wrapping', async () => {
    await type('k');
    expect(activeLabel()).toBe('Kubernetes');

    await press('ArrowDown');
    expect(activeLabel()).toBe('KubeEdge');

    await press('ArrowDown');
    await press('ArrowDown');
    expect(activeLabel()).toBe('KubeVirt');

    await press('ArrowUp');
    expect(activeLabel()).toBe('KubeEdge');
  });

  it('leaves Home and End to the text caret', async () => {
    await type('k');
    const home = await press('Home');
    const end = await press('End');

    expect(home.defaultPrevented).toBe(false);
    expect(end.defaultPrevented).toBe(false);
    expect(activeLabel()).toBe('Kubernetes');
  });

  it('picks the highlighted row with Enter, shows its label and closes', async () => {
    await type('virt');
    const event = await press('Enter');

    expect(event.defaultPrevented).toBe(true);
    expect(fixture.componentInstance.value()).toBe('kubevirt');
    expect(field().value).toBe('KubeVirt');
    expect(listbox()).toBeNull();
  });

  it('lets Enter through to a form while the list is closed', async () => {
    const event = await press('Enter');

    expect(event.defaultPrevented).toBe(false);
  });

  it('does not report a change when the chosen row is picked again', async () => {
    await set('value', 'envoy');
    const changed = vi.fn();
    fixture.componentInstance.combobox().registerOnChange(changed);
    await type('env');
    await press('Enter');

    expect(changed).not.toHaveBeenCalled();
    expect(listbox()).toBeNull();
  });

  it('closes with Escape, keeps the typed text and stops the key reaching a parent', async () => {
    await type('kube');
    const event = await press('Escape');

    expect(listbox()).toBeNull();
    expect(event.defaultPrevented).toBe(true);
    expect(field().value).toBe('kube');
    expect(fixture.componentInstance.value()).toBeNull();
  });

  it('drops the typed text and reports touched when focus leaves', async () => {
    const touched = vi.fn();
    fixture.componentInstance.combobox().registerOnTouched(touched);
    await set('value', 'envoy');
    field().focus();
    await type('kube');
    field().dispatchEvent(new FocusEvent('blur'));
    await fixture.whenStable();

    expect(listbox()).toBeNull();
    expect(field().value).toBe('Envoy');
    expect(touched).toHaveBeenCalledTimes(1);
  });

  it('closes on Tab without picking and lets the key through', async () => {
    await type('virt');
    const event = await press('Tab');

    expect(event.defaultPrevented).toBe(false);
    expect(listbox()).toBeNull();
    expect(fixture.componentInstance.value()).toBeNull();
  });

  it('shows what the list says when nothing matches, quoting the typed text', async () => {
    await type('zzz');

    expect(empty()?.textContent?.trim()).toBe('No projects match “zzz”');
    expect(empty()?.hasAttribute('role')).toBe(false);
    expect(listbox()?.classList.contains('hidden')).toBe(true);
    expect(visibleRows()).toEqual([]);
    expect(activeId()).toBeNull();
  });

  it('announces the empty message through one persistent live region', async () => {
    const status = (): HTMLElement => (fixture.nativeElement as HTMLElement).querySelector('[role="status"]') as HTMLElement;
    expect(status().textContent?.trim()).toBe('');

    await type('zzz');
    expect(status().textContent?.trim()).toBe('No projects match “zzz”');
    expect(document.querySelectorAll('[role="status"]').length).toBe(1);

    await type('virt');
    expect(status().textContent?.trim()).toBe('');
  });

  it('does nothing on Enter while nothing matches', async () => {
    await type('zzz');
    await press('Enter');

    expect(fixture.componentInstance.value()).toBeNull();
    expect(listbox()).not.toBeNull();
  });

  it('replaces typed but unpicked text when a value is written from outside', async () => {
    await type('kube');
    await press('Escape');
    expect(field().value).toBe('kube');

    fixture.componentInstance.combobox().writeValue('envoy');
    await fixture.whenStable();

    expect(field().value).toBe('Envoy');
  });

  it('drops the highlight from a row whose label stops matching the typed text', async () => {
    await type('kub');
    expect(activeLabel()).toBe('Kubernetes');

    fixture.componentRef.setInput(
      'options',
      OPTIONS.map((option) => (option.value === 'k8s' ? { ...option, label: 'Helm' } : option))
    );
    await fixture.whenStable();

    expect(activeId()).toBeNull();
  });

  it('returns to the full list when the text is cleared', async () => {
    await type('zzz');
    await type('');

    expect(empty()).toBeNull();
    expect(visibleRows().length).toBe(OPTIONS.length);
  });

  it('picks an option on click and keeps focus in the input', async () => {
    await open();
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    optionEls()[3].dispatchEvent(down);
    optionEls()[3].click();
    await fixture.whenStable();

    expect(down.defaultPrevented).toBe(true);
    expect(fixture.componentInstance.value()).toBe('envoy');
    expect(listbox()).toBeNull();
    expect(document.activeElement).toBe(field());
  });

  it('ignores a click on a disabled option', async () => {
    await open();
    optionEls()[1].click();
    await fixture.whenStable();

    expect(optionEls()[1].getAttribute('aria-disabled')).toBe('true');
    expect(fixture.componentInstance.value()).toBeNull();
    expect(listbox()).not.toBeNull();
  });

  it('highlights the option under the pointer, but not a disabled one', async () => {
    await open();
    optionEls()[4].dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    await fixture.whenStable();
    expect(activeLabel()).toBe('KubeVirt');

    optionEls()[1].dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    await fixture.whenStable();
    expect(activeLabel()).toBe('KubeVirt');
  });

  it('marks the chosen row with a check', async () => {
    await set('value', 'envoy');
    await open();

    expect(optionEls()[3].getAttribute('aria-selected')).toBe('true');
    expect(optionEls()[3].querySelector('[data-testid="ui-option-check"]')).not.toBeNull();
    expect(optionEls()[0].querySelector('[data-testid="ui-option-check"]')).toBeNull();
  });

  it('leaves keys that belong to an input method composition alone', async () => {
    await open();
    const event = await press('ArrowDown', { isComposing: true });

    expect(event.defaultPrevented).toBe(false);
  });

  it('describes the field with the hint, or with the error that replaces it', async () => {
    await set('hint', 'The project to follow');
    const hint = host.querySelector('[data-testid="ui-combobox-hint"]') as HTMLElement;
    expect(field().getAttribute('aria-describedby')).toBe(hint.id);
    expect(field().getAttribute('aria-invalid')).toBeNull();

    await set('error', 'Choose a project to continue.');
    const error = host.querySelector('[data-testid="ui-combobox-error"]') as HTMLElement;
    expect(host.querySelector('[data-testid="ui-combobox-hint"]')).toBeNull();
    expect(field().getAttribute('aria-invalid')).toBe('true');
    expect(field().getAttribute('aria-describedby')).toBe(error.id);
  });

  it('marks required for assistive technology', async () => {
    await set('required', true);

    expect(field().getAttribute('aria-required')).toBe('true');
  });

  it('sizes the field by the size input and keeps a forced-colors border', async () => {
    const trigger = host.querySelector('[data-testid="ui-combobox-trigger"]') as HTMLElement;
    expect(trigger.className).toContain('h-ui-medium');
    expect(trigger.className).toContain('forced-colors:border-[color:CanvasText]');

    await set('size', 'tiny');
    expect(trigger.className).toContain('h-ui-tiny');
    expect(trigger.className).toContain('label-12');
  });

  it('is disabled for the keyboard and the pointer, and closes if disabled while open', async () => {
    await open();
    await set('disabled', true);

    expect(field().disabled).toBe(true);
    expect(listbox()).toBeNull();

    (host.querySelector('[data-testid="ui-combobox-trigger"]') as HTMLElement).click();
    await fixture.whenStable();
    expect(listbox()).toBeNull();
  });

  it('gives each instance its own ids', () => {
    const other = create('basic');
    other.detectChanges();

    expect((other.nativeElement as HTMLElement).querySelector('input')?.id).not.toBe(field().id);
  });

  describe('with groups and rich rows', () => {
    let groupsFixture: ComponentFixture<ComboboxHostComponent>;

    const groupsField = (): HTMLInputElement => (groupsFixture.nativeElement as HTMLElement).querySelector('input') as HTMLInputElement;
    const groups = (): HTMLElement[] => Array.from(document.querySelectorAll<HTMLElement>('[role="group"]'));
    const isHidden = (el: HTMLElement): boolean => el.classList.contains('hidden');
    const typeInGroups = async (text: string): Promise<void> => {
      groupsField().value = text;
      groupsField().dispatchEvent(new Event('input', { bubbles: true }));
      await groupsFixture.whenStable();
    };

    beforeEach(async () => {
      groupsFixture = create('groups');
      await groupsFixture.whenStable();
      groupsField().click();
      await groupsFixture.whenStable();
    });

    it('keeps each row looking as projected, and bolds only a plain label', async () => {
      await typeInGroups('rich');
      const rich = document.querySelector('[data-testid="rich-row"]') as HTMLElement;

      expect(rich.textContent).toBe('Rich content row');
      expect(rich.querySelector('strong')).toBeNull();
    });

    it('hides a group when none of its rows match, and only that group', async () => {
      await typeInGroups('sig');

      const visibleOptions = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).filter((el) => !isHidden(el));
      expect(visibleOptions.map((el) => el.textContent?.trim())).toEqual(['Sigstore']);
      expect(groups().map((el) => [el.textContent?.includes('Cloud native'), isHidden(el)])).toEqual([
        [true, true],
        [false, false],
      ]);

      await typeInGroups('');
      expect(groups().map(isHidden)).toEqual([false, false]);
    });
  });

  describe('with a reactive form control', () => {
    let formFixture: ComponentFixture<ComboboxHostComponent>;

    const formField = (): HTMLInputElement => (formFixture.nativeElement as HTMLElement).querySelector('input') as HTMLInputElement;

    beforeEach(async () => {
      formFixture = create('form');
      await formFixture.whenStable();
    });

    it('writes the control value into the field', () => {
      expect(formField().value).toBe('Envoy');
    });

    it('updates the control from a pick and marks it touched on blur', async () => {
      formField().focus();
      formField().value = 'virt';
      formField().dispatchEvent(new Event('input', { bubbles: true }));
      await formFixture.whenStable();
      formField().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true, cancelable: true }));
      formField().dispatchEvent(new FocusEvent('blur'));
      await formFixture.whenStable();

      expect(formFixture.componentInstance.control.value).toBe('kubevirt');
      expect(formFixture.componentInstance.control.touched).toBe(true);
    });

    it('follows control.setValue(), control.disable() and reset()', async () => {
      formFixture.componentInstance.control.setValue('kubeedge');
      formFixture.componentInstance.control.disable();
      await formFixture.whenStable();
      expect(formField().value).toBe('KubeEdge');
      expect(formField().disabled).toBe(true);

      formFixture.componentInstance.control.enable();
      formFixture.componentInstance.control.reset();
      await formFixture.whenStable();
      expect(formField().value).toBe('');
    });
  });
});
