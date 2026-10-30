// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { UiShowMoreComponent } from './show-more.component';

@Component({
  selector: 'lfx-ui-show-more-test-host',
  imports: [UiShowMoreComponent],
  template: `<lfx-ui-show-more [(expanded)]="expanded" [hiddenCount]="12" controls="more-rows" />`,
})
class HostComponent {
  public readonly expanded = signal(false);
}

describe('UiShowMoreComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HTMLElement;
  const button = (): HTMLButtonElement => host.querySelector('[data-testid="ui-show-more-button"]') as HTMLButtonElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
  });

  it('renders a native button that names the hidden count and points at the controlled region', () => {
    expect(button().tagName).toBe('BUTTON');
    expect(button().getAttribute('type')).toBe('button');
    expect(button().textContent).toContain('Show 12 More');
    expect(button().getAttribute('aria-expanded')).toBe('false');
    expect(button().getAttribute('aria-controls')).toBe('more-rows');
  });

  it('toggles expanded on click, flips the label and the chevron', async () => {
    button().click();
    await fixture.whenStable();

    expect(fixture.componentInstance.expanded()).toBe(true);
    expect(button().getAttribute('aria-expanded')).toBe('true');
    expect(button().textContent).toContain('Show Less');
    expect(host.querySelector('[data-testid="ui-show-more-chevron"]')?.className).toContain('rotate-180');

    button().click();
    await fixture.whenStable();

    expect(fixture.componentInstance.expanded()).toBe(false);
    expect(button().textContent).toContain('Show 12 More');
    expect(host.querySelector('[data-testid="ui-show-more-chevron"]')?.className).not.toContain('rotate-180');
  });

  it('is operable from the keyboard: a native button fires click on Enter and Space', () => {
    // jsdom does not synthesize click from keys, so assert the semantics that give it: a focusable, non-disabled button.
    button().focus();
    expect(document.activeElement).toBe(button());
    expect(button().disabled).toBe(false);
    expect(button().tabIndex).toBe(0);
  });

  it('falls back to "Show More" without a count', async () => {
    const show = TestBed.createComponent(UiShowMoreComponent);
    show.componentRef.setInput('controls', 'x');
    await show.whenStable();

    expect(show.nativeElement.textContent).toContain('Show More');
  });

  it('draws the rules by default and drops them with noBorder', async () => {
    const rules = (): NodeListOf<Element> => host.querySelectorAll('[data-testid="ui-show-more-rule"]');
    expect(rules().length).toBe(2);
    expect(rules()[0].className).toContain('bg-ui-neutral-alpha-200');
    expect(button().className).toContain('shadow-border');

    const show = TestBed.createComponent(UiShowMoreComponent);
    show.componentRef.setInput('controls', 'x');
    show.componentRef.setInput('noBorder', '');
    await show.whenStable();
    const el = show.nativeElement as HTMLElement;

    expect(el.querySelector('[data-testid="ui-show-more-rule"]')?.className).toContain('bg-transparent');
    expect(el.querySelector('button')?.className).not.toContain('shadow-border');
  });

  it('shows the library focus ring on keyboard focus', () => {
    expect(button().className).toContain('focus-visible:shadow-focus');
  });
});
