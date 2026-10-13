// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { ExpandableTextComponent } from './expandable-text.component';

@Component({
  selector: 'lfx-expandable-text-test-host',
  imports: [ExpandableTextComponent],
  template: `<lfx-expandable-text [maxHeight]="20"><p>Long text</p></lfx-expandable-text>`,
})
class HostComponent {}

/** #3260: one disclosure toggle that keeps focus and reports its state; the V1-facing testids are kept. */
describe('ExpandableTextComponent toggle', () => {
  let fixture: ComponentFixture<HostComponent>;
  let text: ExpandableTextComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    // The height check needs layout, which jsdom lacks: put the component in the overflowing state.
    text = fixture.debugElement.children[0].componentInstance as ExpandableTextComponent;
    text.needsExpansion.set(true);
    text.isInitialized.set(true);
    fixture.detectChanges();
  });

  const toggle = (): HTMLButtonElement => fixture.nativeElement.querySelector('button');

  it('flips one button, which keeps focus, between Show more and See less', () => {
    const button = toggle();
    expect(button.getAttribute('data-testid')).toBe('read-more-button');
    expect(button.getAttribute('aria-expanded')).toBe('false');

    button.focus();
    button.click();
    fixture.detectChanges();

    expect(toggle()).toBe(button);
    expect(button.getAttribute('data-testid')).toBe('see-less-button');
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(button);
  });

  it('points the toggle at the region it expands', () => {
    const region = fixture.nativeElement.querySelector('[data-testid="expandable-content"]');
    expect(region.id).toBeTruthy();
    expect(toggle().getAttribute('aria-controls')).toBe(region.id);
  });

  it('hides its chevrons from assistive tech', () => {
    expect(toggle().querySelector('i')?.getAttribute('aria-hidden')).toBe('true');
  });
});
