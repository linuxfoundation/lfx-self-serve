// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { beforeEach, describe, expect, it } from 'vitest';

import { UiCheckboxComponent } from './checkbox.component';

@Component({
  selector: 'lfx-ui-test-form-host',
  imports: [UiCheckboxComponent, ReactiveFormsModule],
  template: `<lfx-ui-checkbox label="Notify subscribers" [formControl]="control" />`,
})
class FormHostComponent {
  public readonly control = new FormControl<boolean>(false);
}

@Component({
  selector: 'lfx-ui-test-model-host',
  imports: [UiCheckboxComponent],
  template: `<lfx-ui-checkbox label="Notify subscribers" [(checked)]="value" />`,
})
class ModelHostComponent {
  public value = false;
}

describe('UiCheckboxComponent', () => {
  let fixture: ComponentFixture<UiCheckboxComponent>;
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [UiCheckboxComponent, FormHostComponent, ModelHostComponent] }).compileComponents();
    fixture = TestBed.createComponent(UiCheckboxComponent);
    host = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
  });

  const inputOf = (root: HTMLElement = host) => root.querySelector<HTMLInputElement>('[data-testid="ui-checkbox-input"]') as HTMLInputElement;

  it('renders a native checkbox inside its label', () => {
    expect(inputOf().type).toBe('checkbox');
    expect(inputOf().closest('label')).not.toBeNull();
  });

  it('shows the label text and uses it as the accessible name', async () => {
    fixture.componentRef.setInput('label', 'Notify subscribers');
    await fixture.whenStable();

    expect(host.querySelector('[data-testid="ui-checkbox-text"]')?.textContent?.trim()).toBe('Notify subscribers');
    expect(inputOf().hasAttribute('aria-label')).toBe(false);
  });

  it('falls back to ariaLabel when there is no visible label', async () => {
    fixture.componentRef.setInput('ariaLabel', 'Select row');
    await fixture.whenStable();

    expect(inputOf().getAttribute('aria-label')).toBe('Select row');
  });

  it('is unchecked by default and draws no mark', () => {
    expect(inputOf().checked).toBe(false);
    expect(host.querySelector('[data-testid="ui-checkbox-check"]')).toBeNull();
    expect(host.querySelector('[data-testid="ui-checkbox-dash"]')).toBeNull();
  });

  it('toggles the checked model on click, which is what Space does on a native checkbox', async () => {
    inputOf().click();
    await fixture.whenStable();

    expect(fixture.componentInstance.checked()).toBe(true);
    expect(host.querySelector('[data-testid="ui-checkbox-check"]')).not.toBeNull();

    inputOf().click();
    await fixture.whenStable();

    expect(fixture.componentInstance.checked()).toBe(false);
  });

  it('reflects the checked model in the native input', async () => {
    fixture.componentInstance.checked.set(true);
    await fixture.whenStable();

    expect(inputOf().checked).toBe(true);
  });

  it('shows the dash and sets the native indeterminate state', async () => {
    fixture.componentInstance.indeterminate.set(true);
    await fixture.whenStable();

    expect(inputOf().indeterminate).toBe(true);
    expect(host.querySelector('[data-testid="ui-checkbox-dash"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="ui-checkbox-check"]')).toBeNull();
  });

  it('clears indeterminate and checks the box when an indeterminate box is clicked', async () => {
    fixture.componentInstance.indeterminate.set(true);
    await fixture.whenStable();

    inputOf().click();
    await fixture.whenStable();

    expect(fixture.componentInstance.indeterminate()).toBe(false);
    expect(fixture.componentInstance.checked()).toBe(true);
  });

  it('disables the native input and ignores clicks', async () => {
    fixture.componentRef.setInput('disabled', true);
    await fixture.whenStable();

    inputOf().click();
    await fixture.whenStable();

    expect(inputOf().disabled).toBe(true);
    expect(fixture.componentInstance.checked()).toBe(false);
  });

  it('forwards name to the native input', async () => {
    fixture.componentRef.setInput('name', 'notify');
    await fixture.whenStable();

    expect(inputOf().name).toBe('notify');
  });

  describe('two-way binding', () => {
    it('writes user changes to [(checked)]', async () => {
      const hostFixture = TestBed.createComponent(ModelHostComponent);
      await hostFixture.whenStable();

      inputOf(hostFixture.nativeElement).click();
      await hostFixture.whenStable();

      expect(hostFixture.componentInstance.value).toBe(true);
    });
  });

  describe('reactive forms', () => {
    let hostFixture: ComponentFixture<FormHostComponent>;

    beforeEach(async () => {
      hostFixture = TestBed.createComponent(FormHostComponent);
      await hostFixture.whenStable();
    });

    it('writes the control value into the input', async () => {
      hostFixture.componentInstance.control.setValue(true);
      await hostFixture.whenStable();

      expect(inputOf(hostFixture.nativeElement).checked).toBe(true);
    });

    it('updates the control when the user clicks', async () => {
      inputOf(hostFixture.nativeElement).click();
      await hostFixture.whenStable();

      expect(hostFixture.componentInstance.control.value).toBe(true);
    });

    it('leaves indeterminate alone when the control writes a value', async () => {
      const checkbox = hostFixture.debugElement.children[0].componentInstance as UiCheckboxComponent;
      checkbox.indeterminate.set(true);
      hostFixture.componentInstance.control.setValue(true);
      await hostFixture.whenStable();

      expect(checkbox.indeterminate()).toBe(true);
      expect(checkbox.checked()).toBe(true);
    });

    it('marks the control touched on blur', async () => {
      inputOf(hostFixture.nativeElement).dispatchEvent(new Event('blur'));
      await hostFixture.whenStable();

      expect(hostFixture.componentInstance.control.touched).toBe(true);
    });

    it('applies the control disabled state', async () => {
      hostFixture.componentInstance.control.disable();
      await hostFixture.whenStable();

      expect(inputOf(hostFixture.nativeElement).disabled).toBe(true);
    });
  });
});
