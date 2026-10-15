// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, FormGroup } from '@angular/forms';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MultiSelect } from 'primeng/multiselect';
import { afterEach, describe, expect, it } from 'vitest';

import { MultiSelectComponent } from './multi-select.component';

describe('MultiSelectComponent — placeholderOnly', () => {
  let fixture: ComponentFixture<MultiSelectComponent>;

  afterEach(() => fixture?.destroy());

  const render = async (placeholderOnly?: boolean): Promise<MultiSelect> => {
    await TestBed.configureTestingModule({ imports: [MultiSelectComponent], providers: [provideNoopAnimations()] }).compileComponents();

    fixture = TestBed.createComponent(MultiSelectComponent);
    fixture.componentRef.setInput('form', new FormGroup({ picks: new FormControl<string[]>(['a']) }));
    fixture.componentRef.setInput('control', 'picks');
    fixture.componentRef.setInput('options', [
      { label: 'Alpha', value: 'a' },
      { label: 'Beta', value: 'b' },
    ]);
    fixture.componentRef.setInput('placeholder', 'Select group(s)');
    if (placeholderOnly !== undefined) {
      fixture.componentRef.setInput('placeholderOnly', placeholderOnly);
    }
    await fixture.whenStable();

    return fixture.debugElement.query(By.directive(MultiSelect)).componentInstance as MultiSelect;
  };

  it('lists the selection in the trigger by default', async () => {
    const multiSelect = await render();

    expect(multiSelect.selectedItemsTemplate).toBeFalsy();
    expect(fixture.nativeElement.textContent).toContain('Alpha');
  });

  it('keeps showing the placeholder over a selection when opted in', async () => {
    const multiSelect = await render(true);

    expect(multiSelect.selectedItemsTemplate).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('Select group(s)');
    expect(fixture.nativeElement.textContent).not.toContain('Alpha');
  });
});
