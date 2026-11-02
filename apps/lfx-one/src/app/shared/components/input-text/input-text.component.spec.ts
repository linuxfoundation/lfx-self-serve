// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, FormGroup } from '@angular/forms';
import { beforeEach, describe, expect, it } from 'vitest';

import { InputTextComponent } from './input-text.component';

describe('InputTextComponent — ariaLabel', () => {
  let fixture: ComponentFixture<InputTextComponent>;

  const nativeInput = (): HTMLInputElement => {
    const el = fixture.nativeElement.querySelector('input');
    if (!el) throw new Error('no input rendered');
    return el as HTMLInputElement;
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [InputTextComponent] }).compileComponents();

    fixture = TestBed.createComponent(InputTextComponent);
    fixture.componentRef.setInput('form', new FormGroup({ search: new FormControl('') }));
    fixture.componentRef.setInput('control', 'search');
    await fixture.whenStable();
  });

  it('omits aria-label when none is given', () => {
    expect(nativeInput().hasAttribute('aria-label')).toBe(false);
  });

  it('names the native input with ariaLabel', async () => {
    fixture.componentRef.setInput('ariaLabel', 'Search all employees');
    await fixture.whenStable();

    expect(nativeInput().getAttribute('aria-label')).toBe('Search all employees');
  });

  it('names the native input with ariaLabel when it shows an icon', async () => {
    fixture.componentRef.setInput('icon', 'fa-light fa-magnifying-glass');
    fixture.componentRef.setInput('ariaLabel', 'Search contributors');
    await fixture.whenStable();

    expect(nativeInput().getAttribute('aria-label')).toBe('Search contributors');
  });
});
