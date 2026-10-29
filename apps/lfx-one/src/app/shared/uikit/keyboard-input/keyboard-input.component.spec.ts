// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { UiKeyboardInputComponent } from './keyboard-input.component';

describe('UiKeyboardInputComponent', () => {
  let fixture: ComponentFixture<UiKeyboardInputComponent>;
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [UiKeyboardInputComponent] }).compileComponents();
    fixture = TestBed.createComponent(UiKeyboardInputComponent);
    host = fixture.nativeElement as HTMLElement;
    fixture.componentRef.setInput('keys', ['⌘', 'K']);
    await fixture.whenStable();
  });

  const keys = () => Array.from(host.querySelectorAll('kbd'));

  it('renders one kbd per key, in order', () => {
    expect(keys().map((key) => key.textContent?.trim())).toEqual(['⌘', 'K']);
  });

  it('groups the keys with a 4px gap', () => {
    expect(host.className).toContain('inline-flex');
    expect(host.className).toContain('gap-[4px]');
  });

  it('renders a chord passed as one key in a single kbd', async () => {
    fixture.componentRef.setInput('keys', ['⌘K']);
    await fixture.whenStable();

    expect(keys().length).toBe(1);
    expect(keys()[0].textContent?.trim()).toBe('⌘K');
  });

  it('renders a word key such as Enter', async () => {
    fixture.componentRef.setInput('keys', ['Enter']);
    await fixture.whenStable();

    expect(keys()[0].textContent?.trim()).toBe('Enter');
  });

  it('is 24px tall with a hairline ring and 14px secondary text by default', () => {
    const key = keys()[0];
    expect(key.className).toContain('h-ui-tiny');
    expect(key.className).toContain('min-w-[24px]');
    expect(key.className).toContain('px-[6px]');
    expect(key.className).toContain('label-14');
    expect(key.className).toContain('edge');
    expect(key.className).toContain('bg-ui-background-100');
    expect(key.className).toContain('text-ui-neutral-600');
    expect(key.className).toContain('rounded-ui-xs');
  });

  it('is 20px tall with 12px text at the sm size', async () => {
    fixture.componentRef.setInput('size', 'sm');
    await fixture.whenStable();

    const key = keys()[0];
    expect(key.className).toContain('h-[20px]');
    expect(key.className).toContain('min-w-[20px]');
    expect(key.className).toContain('px-[4px]');
    expect(key.className).toContain('label-12');
    expect(key.className).not.toContain('h-ui-tiny');
  });

  it('keeps a test id on the host and on every key', () => {
    expect(host.getAttribute('data-testid')).toBe('ui-keyboard-input');
    expect(host.querySelectorAll('[data-testid="ui-keyboard-input-key"]').length).toBe(2);
  });
});
