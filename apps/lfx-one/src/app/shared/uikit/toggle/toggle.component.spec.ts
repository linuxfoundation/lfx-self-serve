// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { beforeEach, describe, expect, it } from 'vitest';

import { UiToggleComponent } from './toggle.component';

@Component({
  selector: 'lfx-ui-test-form-host',
  imports: [UiToggleComponent, ReactiveFormsModule],
  template: `<lfx-ui-toggle label="Email notifications" [formControl]="control" />`,
})
class FormHostComponent {
  public readonly control = new FormControl<boolean>(false);
}

@Component({
  selector: 'lfx-ui-test-model-host',
  imports: [UiToggleComponent],
  template: `<lfx-ui-toggle label="Email notifications" [(checked)]="value" />`,
})
class ModelHostComponent {
  public value = false;
}

describe('UiToggleComponent', () => {
  let fixture: ComponentFixture<UiToggleComponent>;
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [UiToggleComponent, FormHostComponent, ModelHostComponent] }).compileComponents();
    fixture = TestBed.createComponent(UiToggleComponent);
    host = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
  });

  const inputOf = (root: HTMLElement = host) => root.querySelector<HTMLInputElement>('[data-testid="ui-toggle-input"]') as HTMLInputElement;

  it('is a native checkbox with role switch inside its label', () => {
    expect(inputOf().type).toBe('checkbox');
    expect(inputOf().getAttribute('role')).toBe('switch');
    expect(inputOf().closest('label')).not.toBeNull();
  });

  it('shows the label after the control and uses it as the accessible name', async () => {
    fixture.componentRef.setInput('label', 'Email notifications');
    await fixture.whenStable();

    expect(host.querySelector('[data-testid="ui-toggle-text"]')?.textContent?.trim()).toBe('Email notifications');
    expect(inputOf().nextElementSibling?.getAttribute('data-testid')).toBe('ui-toggle-text');
    expect(inputOf().hasAttribute('aria-label')).toBe(false);
  });

  it('falls back to ariaLabel when there is no visible label', async () => {
    fixture.componentRef.setInput('ariaLabel', 'Maintenance mode');
    await fixture.whenStable();

    expect(inputOf().getAttribute('aria-label')).toBe('Maintenance mode');
  });

  it('is off by default', () => {
    expect(inputOf().checked).toBe(false);
  });

  it('toggles the checked model on click, which is what Space does on a native checkbox', async () => {
    inputOf().click();
    await fixture.whenStable();
    expect(fixture.componentInstance.checked()).toBe(true);

    inputOf().click();
    await fixture.whenStable();
    expect(fixture.componentInstance.checked()).toBe(false);
  });

  it('reflects the checked model in the native input', async () => {
    fixture.componentInstance.checked.set(true);
    await fixture.whenStable();

    expect(inputOf().checked).toBe(true);
  });

  it('applies the accent track when on and the neutral track when off', async () => {
    expect(inputOf().className).toContain('bg-ui-neutral-100');

    fixture.componentInstance.checked.set(true);
    await fixture.whenStable();

    expect(inputOf().className).toContain('bg-ui-accent-500');
    expect(inputOf().className).not.toContain('bg-ui-neutral-100');
  });

  it('uses the warning and danger tones when on', async () => {
    fixture.componentInstance.checked.set(true);
    fixture.componentRef.setInput('tone', 'warning');
    await fixture.whenStable();
    expect(inputOf().className).toContain('bg-ui-warning-600');

    fixture.componentRef.setInput('tone', 'danger');
    await fixture.whenStable();
    expect(inputOf().className).toContain('bg-ui-danger-600');
  });

  it('maps size to the track size class', async () => {
    expect(inputOf().className).toContain('ui-toggle-default');

    fixture.componentRef.setInput('size', 'medium');
    await fixture.whenStable();
    expect(inputOf().className).toContain('ui-toggle-medium');

    fixture.componentRef.setInput('size', 'large');
    await fixture.whenStable();
    expect(inputOf().className).toContain('ui-toggle-large');
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
    fixture.componentRef.setInput('name', 'email');
    await fixture.whenStable();

    expect(inputOf().name).toBe('email');
  });

  it('writes user changes to [(checked)]', async () => {
    const hostFixture = TestBed.createComponent(ModelHostComponent);
    await hostFixture.whenStable();

    inputOf(hostFixture.nativeElement).click();
    await hostFixture.whenStable();

    expect(hostFixture.componentInstance.value).toBe(true);
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
