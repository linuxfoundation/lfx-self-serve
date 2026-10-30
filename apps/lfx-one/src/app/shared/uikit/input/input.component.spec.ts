// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { COMPOSITION_BUFFER_MODE, FormControl, ReactiveFormsModule } from '@angular/forms';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UiInputComponent } from './input.component';

@Component({
  selector: 'lfx-ui-input-test-host',
  imports: [UiInputComponent, ReactiveFormsModule],
  template: `<lfx-ui-input label="Project name" [formControl]="control" />`,
})
class FormHostComponent {
  public readonly control = new FormControl('kubernetes', { nonNullable: true });
}

describe('UiInputComponent', () => {
  let fixture: ComponentFixture<UiInputComponent>;
  let host: HTMLElement;

  const field = (): HTMLInputElement => host.querySelector('[data-testid="ui-input"]') as HTMLInputElement;
  const wrapper = (): HTMLElement => host.querySelector('[data-testid="ui-input-wrapper"]') as HTMLElement;
  const set = async (name: string, value: unknown): Promise<void> => {
    fixture.componentRef.setInput(name, value);
    await fixture.whenStable();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [UiInputComponent, FormHostComponent] }).compileComponents();
    fixture = TestBed.createComponent(UiInputComponent);
    host = fixture.nativeElement as HTMLElement;
    fixture.componentRef.setInput('label', 'Project name');
    await fixture.whenStable();
  });

  it('links the visible label to the input', () => {
    const label = host.querySelector('[data-testid="ui-input-label"]') as HTMLLabelElement;

    expect(label.htmlFor).toBe(field().id);
    expect(field().getAttribute('aria-label')).toBeNull();
  });

  it('uses ariaLabel when there is no visible label', async () => {
    await set('label', '');
    await set('ariaLabel', 'Search projects');

    expect(host.querySelector('[data-testid="ui-input-label"]')).toBeNull();
    expect(field().getAttribute('aria-label')).toBe('Search projects');
  });

  it('writes typed text to the value model', async () => {
    field().value = 'linux';
    field().dispatchEvent(new Event('input'));
    await fixture.whenStable();

    expect(fixture.componentInstance.value()).toBe('linux');
  });

  it('describes the field with the hint', async () => {
    await set('hint', 'Lowercase letters only');
    const hint = host.querySelector('[data-testid="ui-input-hint"]') as HTMLElement;

    expect(field().getAttribute('aria-describedby')).toBe(hint.id);
    expect(field().getAttribute('aria-invalid')).toBeNull();
  });

  it('shows the error instead of the hint, marks the field invalid and describes it', async () => {
    await set('hint', 'Lowercase letters only');
    await set('error', 'Use lowercase letters only.');
    const error = host.querySelector('[data-testid="ui-input-error"]') as HTMLElement;

    expect(host.querySelector('[data-testid="ui-input-hint"]')).toBeNull();
    expect(error.textContent).toContain('Use lowercase letters only.');
    expect(error.getAttribute('role')).toBe('alert');
    expect(field().getAttribute('aria-invalid')).toBe('true');
    expect(field().getAttribute('aria-describedby')).toBe(error.id);
  });

  it('renders icon and text affixes', async () => {
    await set('prefixText', 'https://');
    await set('suffixIcon', 'fa-light fa-link');

    expect(host.querySelector('[data-testid="ui-input-prefix"]')?.textContent).toContain('https://');
    expect(host.querySelector('[data-testid="ui-input-suffix"] i')?.className).toContain('fa-link');
  });

  it('keeps a visible border and focus outline in forced-colors mode', async () => {
    expect(wrapper().className).toContain('forced-colors:border-[color:CanvasText]');
    expect(wrapper().className).toContain('forced-colors:focus-within:outline-[color:Highlight]');

    await set('error', 'Use lowercase letters only.');
    expect(wrapper().className).toContain('forced-colors:border-[color:CanvasText]');

    await set('disabled', true);
    expect(wrapper().className).toContain('forced-colors:border-[color:GrayText]');
  });

  it('sizes the wrapper by the size input', async () => {
    expect(wrapper().className).toContain('h-ui-medium');
    await set('size', 'tiny');
    expect(wrapper().className).toContain('h-ui-tiny');
    await set('rounded', true);
    expect(wrapper().className).toContain('rounded-ui-full');
  });

  it('leaves autocomplete to the browser unless a token is set', async () => {
    expect(field().hasAttribute('autocomplete')).toBe(false);

    await set('autocomplete', 'email');

    expect(field().getAttribute('autocomplete')).toBe('email');
  });

  it('zeroes the input padding next to an unstyled affix only', async () => {
    await set('prefixText', '$');
    await set('suffixText', 'USD');

    expect(field().className).toContain('pl-0');
    expect(field().className).toContain('pr-0');

    await set('affixStyled', true);

    expect(field().className).not.toContain('pl-0');
    expect(field().className).not.toContain('pr-0');
  });

  it('forwards inputmode to the native input only when set', async () => {
    expect(field().hasAttribute('inputmode')).toBe(false);

    await set('inputmode', 'numeric');

    expect(field().getAttribute('inputmode')).toBe('numeric');
  });

  it('reads the affix text with the field, before the hint', async () => {
    await set('prefixText', 'https://');
    await set('suffixText', '.org');
    await set('hint', 'Your site');
    const prefix = host.querySelector('[data-testid="ui-input-prefix"]') as HTMLElement;
    const suffix = host.querySelector('[data-testid="ui-input-suffix"]') as HTMLElement;
    const hint = host.querySelector('[data-testid="ui-input-hint"]') as HTMLElement;

    expect(field().getAttribute('aria-describedby')).toBe(`${prefix.id} ${suffix.id} ${hint.id}`);
  });

  it('does not describe an icon-only affix', async () => {
    await set('prefixIcon', 'fa-light fa-link');

    expect(field().getAttribute('aria-describedby')).toBeNull();
  });

  it('holds back IME composition text until composition ends', async () => {
    const seen: string[] = [];
    fixture.componentInstance.registerOnChange((v) => seen.push(v));

    field().dispatchEvent(new CompositionEvent('compositionstart'));
    field().value = 'に';
    field().dispatchEvent(new Event('input'));
    field().value = '日本';
    field().dispatchEvent(new Event('input'));
    await fixture.whenStable();

    expect(seen).toEqual([]);
    expect(fixture.componentInstance.value()).toBe('');

    field().dispatchEvent(new CompositionEvent('compositionend'));
    await fixture.whenStable();

    expect(seen).toEqual(['日本']);
    expect(fixture.componentInstance.value()).toBe('日本');
  });

  it('gives each instance its own ids', () => {
    const other = TestBed.createComponent(UiInputComponent);
    other.detectChanges();

    expect((other.nativeElement as HTMLElement).querySelector('input')?.id).not.toBe(field().id);
  });

  it('disables the field', async () => {
    await set('disabled', true);

    expect(field().disabled).toBe(true);
  });

  it('drops the hover ring when disabled', async () => {
    expect(wrapper().className).toContain('edge-hover');

    await set('disabled', true);

    expect(wrapper().className).not.toContain('edge-hover');
  });

  describe('with a reactive form control', () => {
    let formFixture: ComponentFixture<FormHostComponent>;

    beforeEach(async () => {
      formFixture = TestBed.createComponent(FormHostComponent);
      await formFixture.whenStable();
    });

    const formField = (): HTMLInputElement => (formFixture.nativeElement as HTMLElement).querySelector('input') as HTMLInputElement;

    it('writes the control value into the field', () => {
      expect(formField().value).toBe('kubernetes');
    });

    it('updates the control and its touched state from the field', async () => {
      formField().value = 'envoy';
      formField().dispatchEvent(new Event('input'));
      formField().dispatchEvent(new Event('blur'));
      await formFixture.whenStable();

      expect(formFixture.componentInstance.control.value).toBe('envoy');
      expect(formFixture.componentInstance.control.touched).toBe(true);
    });

    it('follows control.disable() and control.setValue()', async () => {
      formFixture.componentInstance.control.setValue('istio');
      formFixture.componentInstance.control.disable();
      await formFixture.whenStable();

      expect(formField().value).toBe('istio');
      expect(formField().disabled).toBe(true);
    });
  });
});

describe('UiInputComponent composition buffering', () => {
  const create = async (token?: boolean): Promise<{ fixture: ComponentFixture<UiInputComponent>; seen: string[]; field: HTMLInputElement }> => {
    TestBed.configureTestingModule({
      imports: [UiInputComponent],
      providers: token === undefined ? [] : [{ provide: COMPOSITION_BUFFER_MODE, useValue: token }],
    });
    const fixture = TestBed.createComponent(UiInputComponent);
    const seen: string[] = [];
    fixture.componentInstance.registerOnChange((v) => seen.push(v));
    await fixture.whenStable();
    const field = (fixture.nativeElement as HTMLElement).querySelector('input') as HTMLInputElement;
    field.dispatchEvent(new CompositionEvent('compositionstart'));
    field.value = 'kube';
    field.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    return { fixture, seen, field };
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('buffers by default off Android', async () => {
    const { seen } = await create();

    expect(seen).toEqual([]);
  });

  it('does not buffer on Android, where ordinary typing is composition', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/126.0 Mobile');
    const { seen, fixture, field } = await create();
    field.dispatchEvent(new CompositionEvent('compositionend'));
    await fixture.whenStable();

    expect(seen).toEqual(['kube']);
    expect(fixture.componentInstance.value()).toBe('kube');
  });

  it('follows COMPOSITION_BUFFER_MODE: false', async () => {
    const { seen, fixture, field } = await create(false);
    field.dispatchEvent(new CompositionEvent('compositionend'));
    await fixture.whenStable();

    expect(seen).toEqual(['kube']);
  });

  it('follows COMPOSITION_BUFFER_MODE: true even on Android', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/126.0 Mobile');
    const { seen } = await create(true);

    expect(seen).toEqual([]);
  });
});
