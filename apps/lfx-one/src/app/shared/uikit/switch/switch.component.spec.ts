// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { UiSwitchSize } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it } from 'vitest';

import { UiSwitchOptionComponent } from './switch-option.component';
import { UiSwitchComponent } from './switch.component';

@Component({
  selector: 'lfx-ui-test-model-host',
  imports: [UiSwitchComponent, UiSwitchOptionComponent],
  template:
    '<lfx-ui-switch ariaLabel="Range" [size]="size()" [disabled]="disabled()" [name]="name()" [(value)]="value"><lfx-ui-switch-option value="24h" label="24h" /><lfx-ui-switch-option value="7d" label="7d" /><lfx-ui-switch-option value="30d" label="30d" /><lfx-ui-switch-option value="90d" label="90d" [disabled]="true" /><lfx-ui-switch-option value="list" label="List" icon="fa-light fa-list" [iconOnly]="true" /><lfx-ui-switch-option value="code" label="Code" icon="fa-light fa-code" /></lfx-ui-switch>',
})
class ModelHostComponent {
  public readonly size = signal<UiSwitchSize>('medium');
  public readonly disabled = signal(false);
  public readonly name = signal('');
  public readonly value = signal<string | null>('7d');
}

@Component({
  selector: 'lfx-ui-test-form-host',
  imports: [UiSwitchComponent, UiSwitchOptionComponent, ReactiveFormsModule],
  template:
    '<lfx-ui-switch ariaLabel="View" [formControl]="control"><lfx-ui-switch-option value="source" label="Source" /><lfx-ui-switch-option value="output" label="Output" /></lfx-ui-switch><lfx-ui-switch ariaLabel="Other"><lfx-ui-switch-option value="a" label="A" /></lfx-ui-switch>',
})
class FormHostComponent {
  public readonly control = new FormControl<string | null>(null);
}

describe('UiSwitchComponent and UiSwitchOptionComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ModelHostComponent, FormHostComponent] }).compileComponents();
  });

  describe('with [(value)]', () => {
    let fixture: ReturnType<typeof TestBed.createComponent<ModelHostComponent>>;
    let host: HTMLElement;

    beforeEach(async () => {
      fixture = TestBed.createComponent(ModelHostComponent);
      host = fixture.nativeElement as HTMLElement;
      await fixture.whenStable();
    });

    const inputs = () => Array.from(host.querySelectorAll<HTMLInputElement>('[data-testid="ui-switch-option-input"]'));
    const segments = () => Array.from(host.querySelectorAll<HTMLElement>('[data-testid="ui-switch-option-segment"]'));
    const track = () => host.querySelector('[data-testid="ui-switch-track"]') as HTMLElement;

    it('renders a radiogroup named by aria-label', () => {
      expect(track().getAttribute('role')).toBe('radiogroup');
      expect(track().getAttribute('aria-label')).toBe('Range');
    });

    it('renders native radios that share one generated name', () => {
      const names = new Set(inputs().map((input) => input.name));
      expect(inputs().every((input) => input.type === 'radio')).toBe(true);
      expect(names.size).toBe(1);
      expect([...names][0]).toMatch(/^lfx-ui-switch-/);
    });

    it('uses the given name', async () => {
      fixture.componentInstance.name.set('range');
      await fixture.whenStable();
      expect(inputs().every((input) => input.name === 'range')).toBe(true);
    });

    it('checks the option that matches value', () => {
      expect(inputs().map((input) => input.checked)).toEqual([false, true, false, false, false, false]);
    });

    it('writes value back when an option is chosen', async () => {
      inputs()[2].click();
      await fixture.whenStable();
      expect(fixture.componentInstance.value()).toBe('30d');
      expect(inputs().map((input) => input.checked)).toEqual([false, false, true, false, false, false]);
    });

    it('raises only the checked segment', async () => {
      expect(segments()[1].classList).toContain('bg-ui-background-100');
      expect(segments()[1].classList).toContain('shadow-small');
      expect(segments()[0].classList).not.toContain('bg-ui-background-100');
      inputs()[0].click();
      await fixture.whenStable();
      expect(segments()[0].classList).toContain('bg-ui-background-100');
      expect(segments()[1].classList).not.toContain('bg-ui-background-100');
    });

    it('shows the focus ring on the segment when the hidden radio has keyboard focus', () => {
      expect(segments()[0].classList).toContain('peer-focus-visible:shadow-focus');
      expect(inputs()[0].classList).toContain('peer');
    });

    it('disables one option and greys it out', () => {
      expect(inputs()[3].disabled).toBe(true);
      expect(segments()[3].classList).toContain('text-ui-neutral-400');
      expect(segments()[3].classList).toContain('cursor-not-allowed');
    });

    it('disables every option with the group', async () => {
      fixture.componentInstance.disabled.set(true);
      await fixture.whenStable();
      expect(inputs().every((input) => input.disabled)).toBe(true);
    });

    it.each([
      ['tiny', 'h-ui-tiny', 'p-[2px]', 'button-12'],
      ['small', 'h-ui-small', 'p-[3px]', 'label-13'],
      ['medium', 'h-ui-medium', 'p-[3px]', 'button-14'],
    ] as const)('sizes the %s switch', async (size, height, padding, type) => {
      fixture.componentInstance.size.set(size);
      await fixture.whenStable();
      expect(track().classList).toContain(height);
      expect(track().classList).toContain(padding);
      expect(segments()[0].classList).toContain(type);
    });

    it('keeps the label as screen-reader text and a tooltip description on an icon-only option', () => {
      const option = host.querySelectorAll('lfx-ui-switch-option')[4];
      expect(option.querySelector('i')?.getAttribute('aria-hidden')).toBe('true');
      const text = option.querySelector('[data-testid="ui-switch-option-text"]') as HTMLElement;
      expect(text.textContent).toBe('List');
      expect(text.classList).toContain('sr-only');
      const describedBy = (option.querySelector('label') as HTMLElement).getAttribute('aria-describedby');
      expect(describedBy).toBeTruthy();
    });

    it('shows a visible label on a text-only option', () => {
      const option = host.querySelectorAll('lfx-ui-switch-option')[0];
      expect(option.querySelector('i')).toBeNull();
      expect((option.querySelector('[data-testid="ui-switch-option-text"]') as HTMLElement).classList).not.toContain('sr-only');
    });

    it('shows a visible label next to an icon on a labelled option', () => {
      const option = host.querySelectorAll('lfx-ui-switch-option')[5];
      expect(option.querySelector('i')?.getAttribute('aria-hidden')).toBe('true');
      const text = option.querySelector('[data-testid="ui-switch-option-text"]') as HTMLElement;
      expect(text.textContent).toBe('Code');
      expect(text.classList).not.toContain('sr-only');
    });

    it('gives a checked but disabled segment a GrayText border and no Highlight fill in forced colours', async () => {
      fixture.componentInstance.value.set('90d');
      await fixture.whenStable();
      const classes = segments()[3].classList;
      expect(classes).toContain('forced-colors:border-[color:GrayText]');
      expect(classes).toContain('forced-colors:text-[color:GrayText]');
      expect(classes).not.toContain('forced-colors:bg-[color:Highlight]');
      expect(classes).not.toContain('forced-colors:text-[color:HighlightText]');
    });

    it('marks the checked segment with a Highlight fill and border, and the focus ring with an outline, in forced colours', () => {
      expect(segments()[1].classList).toContain('forced-colors:bg-[color:Highlight]');
      expect(segments()[1].classList).toContain('forced-colors:border');
      expect(segments()[0].classList).not.toContain('forced-colors:bg-[color:Highlight]');
      expect(segments()[0].classList).toContain('forced-colors:peer-focus-visible:outline');
      expect(segments()[3].classList).toContain('forced-colors:text-[color:GrayText]');
    });
  });

  describe('with a reactive-forms control', () => {
    let fixture: ReturnType<typeof TestBed.createComponent<FormHostComponent>>;
    let host: HTMLElement;

    beforeEach(async () => {
      fixture = TestBed.createComponent(FormHostComponent);
      host = fixture.nativeElement as HTMLElement;
      await fixture.whenStable();
    });

    const inputs = (group = 0) =>
      Array.from(host.querySelectorAll('lfx-ui-switch')[group].querySelectorAll<HTMLInputElement>('[data-testid="ui-switch-option-input"]'));

    it('writes the control value into the options', async () => {
      fixture.componentInstance.control.setValue('output');
      await fixture.whenStable();
      expect(inputs().map((input) => input.checked)).toEqual([false, true]);
    });

    it('updates the control and marks it touched only when focus leaves the group', async () => {
      inputs()[0].click();
      await fixture.whenStable();
      expect(fixture.componentInstance.control.value).toBe('source');
      expect(fixture.componentInstance.control.touched).toBe(false);
      const track = host.querySelector('[data-testid="ui-switch-track"]') as HTMLElement;
      track.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: inputs()[1] }));
      expect(fixture.componentInstance.control.touched).toBe(false);
      track.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
      expect(fixture.componentInstance.control.touched).toBe(true);
    });

    it('disables the options when the control is disabled', async () => {
      fixture.componentInstance.control.disable();
      await fixture.whenStable();
      expect(inputs().every((input) => input.disabled)).toBe(true);
    });

    it('keeps two switches independent', () => {
      expect(inputs(0)[0].name).not.toBe(inputs(1)[0].name);
    });
  });
});
