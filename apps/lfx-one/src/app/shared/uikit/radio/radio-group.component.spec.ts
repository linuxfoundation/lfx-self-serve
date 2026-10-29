// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { beforeEach, describe, expect, it } from 'vitest';

import { UiRadioGroupComponent } from './radio-group.component';
import { UiRadioComponent } from './radio.component';

@Component({
  selector: 'lfx-ui-test-model-host',
  imports: [UiRadioGroupComponent, UiRadioComponent],
  template:
    '<lfx-ui-radio-group [label]="label()" [ariaLabel]="ariaLabel()" [disabled]="disabled()" [name]="name()" [(value)]="value"> <lfx-ui-radio value="public" label="Public" /><lfx-ui-radio value="members" label="Members only" /><lfx-ui-radio value="enterprise" label="Enterprise" [disabled]="true" /> </lfx-ui-radio-group>',
})
class ModelHostComponent {
  public readonly label = signal('Visibility');
  public readonly ariaLabel = signal('');
  public readonly disabled = signal(false);
  public readonly name = signal('');
  public readonly value = signal<string | null>('public');
}

@Component({
  selector: 'lfx-ui-test-form-host',
  imports: [UiRadioGroupComponent, UiRadioComponent, ReactiveFormsModule],
  template:
    '<lfx-ui-radio-group label="Visibility" [formControl]="control" ><lfx-ui-radio value="public" label="Public" /><lfx-ui-radio value="members" label="Members only" /></lfx-ui-radio-group> <lfx-ui-radio-group label="Other"><lfx-ui-radio value="a" label="A" /></lfx-ui-radio-group>',
})
class FormHostComponent {
  public readonly control = new FormControl<string | null>(null);
}

describe('UiRadioGroupComponent and UiRadioComponent', () => {
  describe('with [(value)]', () => {
    let fixture: ComponentFixture<ModelHostComponent>;
    let host: HTMLElement;

    beforeEach(async () => {
      await TestBed.configureTestingModule({ imports: [ModelHostComponent, FormHostComponent] }).compileComponents();
      fixture = TestBed.createComponent(ModelHostComponent);
      host = fixture.nativeElement as HTMLElement;
      await fixture.whenStable();
    });

    const inputs = () => Array.from(host.querySelectorAll<HTMLInputElement>('[data-testid="ui-radio-input"]'));

    it('renders a fieldset radiogroup named by its legend', () => {
      const fieldset = host.querySelector('fieldset') as HTMLFieldSetElement;
      expect(fieldset.getAttribute('role')).toBe('radiogroup');
      expect(fieldset.querySelector('legend')?.textContent?.trim()).toBe('Visibility');
      expect(fieldset.hasAttribute('aria-label')).toBe(false);
    });

    it('names the group with ariaLabel when there is no legend', async () => {
      fixture.componentInstance.label.set('');
      fixture.componentInstance.ariaLabel.set('Visibility');
      await fixture.whenStable();

      expect(host.querySelector('legend')).toBeNull();
      expect(host.querySelector('fieldset')?.getAttribute('aria-label')).toBe('Visibility');
    });

    it('renders native radios that share one name, which gives the browser arrow-key roving and a single tab stop', () => {
      expect(inputs().every((input) => input.type === 'radio')).toBe(true);
      expect(new Set(inputs().map((input) => input.name)).size).toBe(1);
      expect(inputs()[0].name).not.toBe('');
    });

    it('uses an explicit name instead of the generated one', async () => {
      fixture.componentInstance.name.set('visibility');
      await fixture.whenStable();

      expect(inputs().every((input) => input.name === 'visibility')).toBe(true);
    });

    it('checks the option matching the group value', () => {
      expect(inputs().map((input) => input.checked)).toEqual([true, false, false]);
      expect(host.querySelectorAll('[data-testid="ui-radio-dot"]').length).toBe(1);
    });

    it('writes the chosen option to [(value)] when an option changes, as arrow keys and clicks do', async () => {
      inputs()[1].click();
      await fixture.whenStable();

      expect(fixture.componentInstance.value()).toBe('members');
      expect(inputs().map((input) => input.checked)).toEqual([false, true, false]);
    });

    it('follows value changes from outside', async () => {
      fixture.componentInstance.value.set('members');
      await fixture.whenStable();

      expect(inputs().map((input) => input.checked)).toEqual([false, true, false]);
    });

    it('checks nothing when the value is null', async () => {
      fixture.componentInstance.value.set(null);
      await fixture.whenStable();

      expect(inputs().some((input) => input.checked)).toBe(false);
    });

    it('disables a single option and ignores clicks on it', async () => {
      expect(inputs()[2].disabled).toBe(true);

      inputs()[2].click();
      await fixture.whenStable();

      expect(fixture.componentInstance.value()).toBe('public');
    });

    it('disables every option when the group is disabled', async () => {
      fixture.componentInstance.disabled.set(true);
      await fixture.whenStable();

      expect(inputs().every((input) => input.disabled)).toBe(true);
    });

    it('shows each option label', () => {
      const labels = Array.from(host.querySelectorAll('[data-testid="ui-radio-text"]')).map((el) => el.textContent?.trim());
      expect(labels).toEqual(['Public', 'Members only', 'Enterprise']);
    });
  });

  describe('with reactive forms', () => {
    let fixture: ComponentFixture<FormHostComponent>;
    let host: HTMLElement;

    beforeEach(async () => {
      await TestBed.configureTestingModule({ imports: [ModelHostComponent, FormHostComponent] }).compileComponents();
      fixture = TestBed.createComponent(FormHostComponent);
      host = fixture.nativeElement as HTMLElement;
      await fixture.whenStable();
    });

    const inputs = () => Array.from(host.querySelectorAll<HTMLInputElement>('[data-testid="ui-radio-input"]'));

    it('writes the control value into the options', async () => {
      fixture.componentInstance.control.setValue('members');
      await fixture.whenStable();

      expect(inputs().map((input) => input.checked)).toEqual([false, true, false]);
    });

    it('updates the control when the user chooses an option', async () => {
      inputs()[0].click();
      await fixture.whenStable();

      expect(fixture.componentInstance.control.value).toBe('public');
    });

    it('marks the control touched when focus leaves the group', async () => {
      inputs()[0].dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
      await fixture.whenStable();

      expect(fixture.componentInstance.control.touched).toBe(true);
    });

    it('does not mark the control touched when focus moves between options', async () => {
      inputs()[0].dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: inputs()[1] }));
      await fixture.whenStable();

      expect(fixture.componentInstance.control.touched).toBe(false);
    });

    it('applies the control disabled state', async () => {
      fixture.componentInstance.control.disable();
      await fixture.whenStable();

      expect(
        inputs()
          .slice(0, 2)
          .every((input) => input.disabled)
      ).toBe(true);
    });

    it('gives separate groups separate names', () => {
      expect(inputs()[0].name).not.toBe(inputs()[2].name);
    });
  });
});
