// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { MeetingV2ExpandableTextComponent } from './v2-expandable-text.component';

@Component({
  selector: 'lfx-meeting-v2-expandable-text-test-host',
  imports: [MeetingV2ExpandableTextComponent],
  template: `<lfx-meeting-v2-expandable-text [maxHeight]="20"><p>Long text</p></lfx-meeting-v2-expandable-text>`,
})
class HostComponent {}

/** #3260: one disclosure toggle that keeps focus and reports its state; the shared component's testids are kept. */
describe('MeetingV2ExpandableTextComponent toggle', () => {
  let fixture: ComponentFixture<HostComponent>;
  let text: MeetingV2ExpandableTextComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    // The height check needs layout, which jsdom lacks: put the component in the overflowing state.
    text = fixture.debugElement.children[0].componentInstance as MeetingV2ExpandableTextComponent;
    text.needsExpansion.set(true);
    text.isInitialized.set(true);
    fixture.detectChanges();
  });

  const toggle = (): HTMLButtonElement => fixture.nativeElement.querySelector('button');

  it('flips one button, which keeps focus, between Show more and See less', () => {
    const button = toggle();
    expect(button.getAttribute('data-testid')).toBe('read-more-button');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.textContent?.trim()).toBe('Show more');

    button.focus();
    button.click();
    fixture.detectChanges();

    expect(toggle()).toBe(button);
    expect(button.getAttribute('data-testid')).toBe('see-less-button');
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(button.textContent?.trim()).toBe('See less');
    expect(document.activeElement).toBe(button);

    button.click();
    fixture.detectChanges();

    expect(toggle()).toBe(button);
    expect(button.getAttribute('aria-expanded')).toBe('false');
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

  it('keeps the shared collapse behaviour: the content is clamped to maxHeight until expanded', () => {
    const region: HTMLElement = fixture.nativeElement.querySelector('[data-testid="expandable-content"]');
    expect(region.style.height).toBe('20px');
    expect(region.classList.contains('collapsed')).toBe(true);
  });
});
