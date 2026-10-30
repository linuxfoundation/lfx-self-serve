// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { UiChoiceboxColumns, UiChoiceboxType } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it } from 'vitest';

import { UiChoiceboxGroupComponent } from './choicebox-group.component';
import { UiChoiceboxComponent } from './choicebox.component';

@Component({
  selector: 'lfx-ui-test-model-host',
  imports: [UiChoiceboxGroupComponent, UiChoiceboxComponent],
  template:
    '<lfx-ui-choicebox-group [label]="label()" [ariaLabel]="ariaLabel()" [type]="type()" [columns]="columns()" [disabled]="disabled()" [name]="name()" [(value)]="value" [(values)]="values"><lfx-ui-choicebox value="gold" label="Gold" description="Elects board representatives." /><lfx-ui-choicebox value="silver" label="Silver" /><lfx-ui-choicebox value="associate" label="Associate" description="For academics." [disabled]="true" disabledReason="Only for academic institutions" /></lfx-ui-choicebox-group>',
})
class ModelHostComponent {
  public readonly label = signal('Membership Tier');
  public readonly ariaLabel = signal('');
  public readonly type = signal<UiChoiceboxType>('radio');
  public readonly columns = signal<UiChoiceboxColumns>(1);
  public readonly disabled = signal(false);
  public readonly name = signal('');
  public readonly value = signal<string | null>('gold');
  public readonly values = signal<string[]>([]);
}

@Component({
  selector: 'lfx-ui-test-form-host',
  imports: [UiChoiceboxGroupComponent, UiChoiceboxComponent, ReactiveFormsModule],
  template:
    '<lfx-ui-choicebox-group label="Tier" [formControl]="tier"><lfx-ui-choicebox value="gold" label="Gold" /><lfx-ui-choicebox value="silver" label="Silver" /></lfx-ui-choicebox-group><lfx-ui-choicebox-group label="Targets" type="checkbox" [formControl]="targets"><lfx-ui-choicebox value="cloud" label="Cloud" /><lfx-ui-choicebox value="edge" label="Edge" /></lfx-ui-choicebox-group><lfx-ui-choicebox-group label="Other"><lfx-ui-choicebox value="a" label="A" /></lfx-ui-choicebox-group>',
})
class FormHostComponent {
  public readonly tier = new FormControl<string | null>(null);
  public readonly targets = new FormControl<string[]>([]);
}

describe('UiChoiceboxGroupComponent and UiChoiceboxComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ModelHostComponent, FormHostComponent] }).compileComponents();
  });

  describe('with [(value)] and [(values)]', () => {
    let fixture: ReturnType<typeof TestBed.createComponent<ModelHostComponent>>;
    let host: HTMLElement;

    beforeEach(async () => {
      fixture = TestBed.createComponent(ModelHostComponent);
      host = fixture.nativeElement as HTMLElement;
      await fixture.whenStable();
    });

    const inputs = () => Array.from(host.querySelectorAll<HTMLInputElement>('[data-testid="ui-choicebox-input"]'));
    const tiles = () => Array.from(host.querySelectorAll<HTMLElement>('[data-testid="ui-choicebox-label"]'));
    const click = async (index: number) => {
      inputs()[index].click();
      await fixture.whenStable();
    };

    it('renders a fieldset radiogroup named by its legend', () => {
      const fieldset = host.querySelector('fieldset') as HTMLFieldSetElement;
      expect(fieldset.getAttribute('role')).toBe('radiogroup');
      expect(host.querySelector('legend')?.textContent?.trim()).toBe('Membership Tier');
      expect(fieldset.hasAttribute('aria-label')).toBe(false);
    });

    it('uses aria-label instead of a legend when there is no label', async () => {
      fixture.componentInstance.label.set('');
      fixture.componentInstance.ariaLabel.set('Tier');
      await fixture.whenStable();
      expect(host.querySelector('legend')).toBeNull();
      expect(host.querySelector('fieldset')?.getAttribute('aria-label')).toBe('Tier');
    });

    it('renders native radios that share one generated name', () => {
      const names = new Set(inputs().map((input) => input.name));
      expect(inputs().every((input) => input.type === 'radio')).toBe(true);
      expect(names.size).toBe(1);
      expect([...names][0]).toMatch(/^lfx-ui-choicebox-group-/);
    });

    it('uses the given name', async () => {
      fixture.componentInstance.name.set('tier');
      await fixture.whenStable();
      expect(inputs().every((input) => input.name === 'tier')).toBe(true);
    });

    it('checks the tile that matches value', () => {
      expect(inputs().map((input) => input.checked)).toEqual([true, false, false]);
    });

    it('writes value back when a tile is chosen', async () => {
      await click(1);
      expect(fixture.componentInstance.value()).toBe('silver');
      expect(inputs().map((input) => input.checked)).toEqual([false, true, false]);
    });

    it('marks the chosen tile with the accent ring and fill', async () => {
      expect(tiles()[0].classList).toContain('bg-ui-accent-50');
      expect(tiles()[0].classList).toContain('ring-ui-accent-500');
      await click(1);
      expect(tiles()[0].classList).not.toContain('bg-ui-accent-50');
      expect(tiles()[1].classList).toContain('bg-ui-accent-50');
    });

    it('shows a dot for a chosen radio and a check for a chosen checkbox', async () => {
      expect(host.querySelector('[data-testid="ui-choicebox-dot"]')).not.toBeNull();
      expect(host.querySelector('[data-testid="ui-choicebox-check"]')).toBeNull();
      fixture.componentInstance.type.set('checkbox');
      fixture.componentInstance.values.set(['gold']);
      await fixture.whenStable();
      expect(host.querySelector('[data-testid="ui-choicebox-dot"]')).toBeNull();
      expect(host.querySelector('[data-testid="ui-choicebox-check"]')).not.toBeNull();
    });

    it('names each input by its title and describes it by its description', () => {
      const [gold, silver] = inputs();
      const title = host.querySelector<HTMLElement>(`#${gold.getAttribute('aria-labelledby')}`);
      expect(title?.textContent?.trim()).toBe('Gold');
      expect(host.querySelector(`#${gold.getAttribute('aria-describedby')}`)?.textContent?.trim()).toBe('Elects board representatives.');
      expect(silver.getAttribute('aria-describedby')).toBeNull();
    });

    it('sets the number of columns', async () => {
      const grid = () => host.querySelector('[data-testid="ui-choicebox-group-fieldset"] > div') as HTMLElement;
      expect(grid().classList).toContain('grid-cols-1');
      fixture.componentInstance.columns.set(3);
      await fixture.whenStable();
      expect(grid().classList).toContain('grid-cols-3');
    });

    it('disables one tile and explains why through a tooltip description and a hidden reason', () => {
      const associate = inputs()[2];
      expect(associate.disabled).toBe(true);
      expect(tiles()[2].classList).toContain('bg-ui-neutral-50');
      expect(tiles()[2].classList).toContain('cursor-not-allowed');
      expect(host.querySelector(`#${associate.getAttribute('aria-describedby')?.split(' ').pop()}`)?.textContent).toBe('Only for academic institutions');
    });

    it('does not describe an enabled tile with a reason', () => {
      expect(host.querySelectorAll('[data-testid="ui-choicebox-reason"]')).toHaveLength(1);
    });

    it('disables every tile with the group', async () => {
      fixture.componentInstance.disabled.set(true);
      await fixture.whenStable();
      expect(inputs().every((input) => input.disabled)).toBe(true);
    });

    it('collects several chosen tiles in checkbox mode and clears them again', async () => {
      fixture.componentInstance.type.set('checkbox');
      fixture.componentInstance.values.set([]);
      await fixture.whenStable();
      expect(host.querySelector('fieldset')?.hasAttribute('role')).toBe(false);
      expect(inputs().every((input) => input.type === 'checkbox')).toBe(true);
      await click(0);
      await click(1);
      expect(fixture.componentInstance.values()).toEqual(['gold', 'silver']);
      await click(0);
      expect(fixture.componentInstance.values()).toEqual(['silver']);
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

    const groupInputs = (group: number) =>
      Array.from(host.querySelectorAll('lfx-ui-choicebox-group')[group].querySelectorAll<HTMLInputElement>('[data-testid="ui-choicebox-input"]'));

    it('writes the control value into the radio tiles', async () => {
      fixture.componentInstance.tier.setValue('silver');
      await fixture.whenStable();
      expect(groupInputs(0).map((input) => input.checked)).toEqual([false, true]);
    });

    it('updates a radio control and marks it touched only when focus leaves the group', async () => {
      groupInputs(0)[0].click();
      await fixture.whenStable();
      expect(fixture.componentInstance.tier.value).toBe('gold');
      expect(fixture.componentInstance.tier.touched).toBe(false);
      const fieldset = host.querySelector('lfx-ui-choicebox-group fieldset') as HTMLElement;
      fieldset.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: groupInputs(0)[1] }));
      expect(fixture.componentInstance.tier.touched).toBe(false);
      fieldset.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
      expect(fixture.componentInstance.tier.touched).toBe(true);
    });

    it('holds a string array for a checkbox group', async () => {
      fixture.componentInstance.targets.setValue(['edge']);
      await fixture.whenStable();
      expect(groupInputs(1).map((input) => input.checked)).toEqual([false, true]);
      groupInputs(1)[0].click();
      await fixture.whenStable();
      expect(fixture.componentInstance.targets.value).toEqual(['edge', 'cloud']);
    });

    it('disables the tiles when the control is disabled', async () => {
      fixture.componentInstance.tier.disable();
      await fixture.whenStable();
      expect(groupInputs(0).every((input) => input.disabled)).toBe(true);
    });

    it('keeps two radio groups independent', () => {
      expect(groupInputs(0)[0].name).not.toBe(groupInputs(2)[0].name);
    });
  });
});
