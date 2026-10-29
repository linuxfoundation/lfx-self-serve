// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { beforeEach, describe, expect, it } from 'vitest';

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

  it('sizes the wrapper by the size input', async () => {
    expect(wrapper().className).toContain('h-ui-medium');
    await set('size', 'tiny');
    expect(wrapper().className).toContain('h-ui-tiny');
    await set('rounded', true);
    expect(wrapper().className).toContain('rounded-ui-full');
  });

  it('disables the field', async () => {
    await set('disabled', true);

    expect(field().disabled).toBe(true);
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
