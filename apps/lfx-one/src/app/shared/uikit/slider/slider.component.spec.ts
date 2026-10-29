// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { beforeEach, describe, expect, it } from 'vitest';

import { UiSliderComponent } from './slider.component';

@Component({
  selector: 'lfx-ui-slider-test-host',
  imports: [UiSliderComponent, ReactiveFormsModule],
  template: `<lfx-ui-slider label="Alert threshold" [formControl]="control" />`,
})
class FormHostComponent {
  public readonly control = new FormControl(40, { nonNullable: true });
}

describe('UiSliderComponent', () => {
  let fixture: ComponentFixture<UiSliderComponent>;
  let host: HTMLElement;

  const range = (): HTMLInputElement => host.querySelector('[data-testid="ui-slider"]') as HTMLInputElement;
  const output = (): HTMLElement => host.querySelector('[data-testid="ui-slider-value"]') as HTMLElement;
  const set = async (name: string, value: unknown): Promise<void> => {
    fixture.componentRef.setInput(name, value);
    await fixture.whenStable();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [UiSliderComponent, FormHostComponent] }).compileComponents();
    fixture = TestBed.createComponent(UiSliderComponent);
    host = fixture.nativeElement as HTMLElement;
    fixture.componentRef.setInput('label', 'Alert threshold');
    fixture.componentRef.setInput('value', 60);
    await fixture.whenStable();
  });

  it('is a native range input named by its label', () => {
    const label = host.querySelector('[data-testid="ui-slider-label"]') as HTMLLabelElement;

    expect(range().type).toBe('range');
    expect(label.htmlFor).toBe(range().id);
    expect(range().min).toBe('0');
    expect(range().max).toBe('100');
    expect(range().step).toBe('1');
    expect(range().value).toBe('60');
  });

  it('shows the current value next to the label', () => {
    expect(output().textContent?.trim()).toBe('60');
    expect(range().getAttribute('aria-valuetext')).toBeNull();
  });

  it('uses value text for the output and aria-valuetext', async () => {
    await set('valueText', '60%');

    expect(output().textContent?.trim()).toBe('60%');
    expect(range().getAttribute('aria-valuetext')).toBe('60%');
  });

  it('fills the track by the value share of the range', async () => {
    await set('min', 10);
    await set('max', 50);
    await set('value', 30);

    expect(range().style.getPropertyValue('--val')).toBe('50%');
  });

  it('clamps a value outside the range', async () => {
    await set('value', 500);

    expect(range().value).toBe('100');
    expect(output().textContent?.trim()).toBe('100');
    expect(range().style.getPropertyValue('--val')).toBe('100%');
  });

  it('shows an off-step value snapped to the step, in the thumb, fill, output and model', async () => {
    await set('step', 10);
    await set('value', 64);

    expect(range().value).toBe('60');
    expect(output().textContent?.trim()).toBe('60');
    expect(range().style.getPropertyValue('--val')).toBe('60%');
    expect(fixture.componentInstance.value()).toBe(64);
  });

  it('emits the snapped value after interaction', async () => {
    await set('step', 10);
    range().value = '47';
    range().dispatchEvent(new Event('input'));
    await fixture.whenStable();

    expect(fixture.componentInstance.value()).toBe(50);
    expect(output().textContent?.trim()).toBe('50');
  });

  it('writes the dragged or keyed value to the model', async () => {
    range().value = '35';
    range().dispatchEvent(new Event('input'));
    await fixture.whenStable();

    expect(fixture.componentInstance.value()).toBe(35);
    expect(output().textContent?.trim()).toBe('35');
  });

  it('disables the slider', async () => {
    await set('disabled', true);

    expect(range().disabled).toBe(true);
  });

  describe('with a reactive form control', () => {
    let formFixture: ComponentFixture<FormHostComponent>;
    const formRange = (): HTMLInputElement => (formFixture.nativeElement as HTMLElement).querySelector('[data-testid="ui-slider"]') as HTMLInputElement;

    beforeEach(async () => {
      formFixture = TestBed.createComponent(FormHostComponent);
      await formFixture.whenStable();
    });

    it('writes the control value and reads changes back', async () => {
      expect(formRange().value).toBe('40');

      formRange().value = '75';
      formRange().dispatchEvent(new Event('input'));
      formRange().dispatchEvent(new Event('blur'));
      await formFixture.whenStable();

      expect(formFixture.componentInstance.control.value).toBe(75);
      expect(formFixture.componentInstance.control.touched).toBe(true);
      expect(formRange().value).toBe('75');
    });

    it('shows an out-of-range control value clamped but leaves the control untouched', async () => {
      formFixture.componentInstance.control.setValue(250);
      await formFixture.whenStable();

      expect(formRange().value).toBe('100');
      expect(formFixture.componentInstance.control.value).toBe(250);
      expect(formFixture.componentInstance.control.dirty).toBe(false);
    });

    it('follows control.disable()', async () => {
      formFixture.componentInstance.control.disable();
      await formFixture.whenStable();

      expect(formRange().disabled).toBe(true);
    });
  });
});
