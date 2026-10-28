// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { UiSearchInputComponent } from './search-input.component';

describe('UiSearchInputComponent', () => {
  let fixture: ComponentFixture<UiSearchInputComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [UiSearchInputComponent] }).compileComponents();
    fixture = TestBed.createComponent(UiSearchInputComponent);
    await fixture.whenStable();
  });

  function input(): HTMLInputElement {
    return fixture.nativeElement.querySelector('[data-testid="ui-search-input"]') as HTMLInputElement;
  }

  it('shows the placeholder and accessible name', async () => {
    fixture.componentRef.setInput('placeholder', 'Search meetings');
    fixture.componentRef.setInput('ariaLabel', 'Search meetings');
    await fixture.whenStable();

    expect(input().placeholder).toBe('Search meetings');
    expect(input().getAttribute('aria-label')).toBe('Search meetings');
  });

  it('reflects the value model in the field', async () => {
    fixture.componentInstance.value.set('kube');
    await fixture.whenStable();

    expect(input().value).toBe('kube');
  });

  it('writes typed text back to the value model', async () => {
    input().value = 'cncf';
    input().dispatchEvent(new Event('input'));
    await fixture.whenStable();

    expect(fixture.componentInstance.value()).toBe('cncf');
  });

  it('disables the field', async () => {
    fixture.componentRef.setInput('disabled', true);
    await fixture.whenStable();

    expect(input().disabled).toBe(true);
  });

  it('keeps a 300px minimum width on the host', () => {
    expect((fixture.nativeElement as HTMLElement).className).toContain('min-w-[min(300px,100%)]');
  });
});
