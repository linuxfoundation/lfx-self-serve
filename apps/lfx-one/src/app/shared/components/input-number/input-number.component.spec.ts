// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, FormGroup } from '@angular/forms';
import { afterEach, describe, expect, it } from 'vitest';

import { InputNumberComponent } from './input-number.component';

describe('InputNumberComponent — native bounds', () => {
  let fixture: ComponentFixture<InputNumberComponent>;

  afterEach(() => fixture?.destroy());

  const render = async (bounds: { min?: number; max?: number } = {}): Promise<HTMLInputElement> => {
    await TestBed.configureTestingModule({ imports: [InputNumberComponent] }).compileComponents();

    fixture = TestBed.createComponent(InputNumberComponent);
    fixture.componentRef.setInput('form', new FormGroup({ hours: new FormControl(2) }));
    fixture.componentRef.setInput('control', 'hours');
    if (bounds.min !== undefined) {
      fixture.componentRef.setInput('min', bounds.min);
    }
    if (bounds.max !== undefined) {
      fixture.componentRef.setInput('max', bounds.max);
    }
    await fixture.whenStable();

    return fixture.nativeElement.querySelector('input');
  };

  it('caps the spinner at the given bounds', async () => {
    const input = await render({ min: 2, max: 24 });

    expect(input.getAttribute('min')).toBe('2');
    expect(input.getAttribute('max')).toBe('24');
  });

  it('leaves the input unbounded when no bounds are given', async () => {
    const input = await render();

    expect(input.hasAttribute('min')).toBe(false);
    expect(input.hasAttribute('max')).toBe(false);
  });
});
