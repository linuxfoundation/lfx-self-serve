// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { UiDescriptionComponent } from './description.component';

describe('UiDescriptionComponent', () => {
  let fixture: ComponentFixture<UiDescriptionComponent>;
  let host: HTMLElement;

  const list = () => host.querySelector('[data-testid="ui-description-list"]') as HTMLElement;
  const label = () => host.querySelector('[data-testid="ui-description-label"]') as HTMLElement;
  const value = () => host.querySelector('[data-testid="ui-description-value"]') as HTMLElement;
  const help = () => host.querySelector('[data-testid="ui-description-help"]');

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [UiDescriptionComponent] }).compileComponents();
    fixture = TestBed.createComponent(UiDescriptionComponent);
    host = fixture.nativeElement as HTMLElement;
    fixture.componentRef.setInput('label', 'Region');
    fixture.componentRef.setInput('value', 'Europe (Lisbon)');
    await fixture.whenStable();
  });

  it('renders a definition list with the title and the value', () => {
    expect(list().tagName).toBe('DL');
    expect(label().tagName).toBe('DT');
    expect(value().tagName).toBe('DD');
    expect(label().textContent?.trim()).toBe('Region');
    expect(value().textContent?.trim()).toBe('Europe (Lisbon)');
  });

  it('styles the title and the value with their type roles and colours', () => {
    expect(label().className).toContain('label-14');
    expect(label().className).toContain('font-medium');
    expect(label().className).toContain('text-ui-neutral-600');
    expect(value().className).toContain('copy-14');
    expect(value().className).toContain('text-ui-neutral-900');
    expect(list().className).toContain('gap-[4px]');
    expect(help()).toBeNull();
  });

  it('right-aligns and uses tabular figures', async () => {
    fixture.componentRef.setInput('align', 'right');
    await fixture.whenStable();

    expect(list().className).toContain('items-end');
    expect(list().className).toContain('text-right');
    expect(value().className).toContain('tabular-nums');
  });

  it('truncates a long value and exposes the full value as a tooltip', async () => {
    expect(value().getAttribute('title')).toBeNull();
    expect(value().className).not.toContain('truncate');

    fixture.componentRef.setInput('ellipsis', true);
    await fixture.whenStable();

    expect(value().className).toContain('truncate');
    expect(value().getAttribute('title')).toBe('Europe (Lisbon)');
  });

  it('shows a named help icon after the title', async () => {
    fixture.componentRef.setInput('help', 'Your membership tier');
    await fixture.whenStable();

    expect(help()?.getAttribute('role')).toBe('img');
    expect(help()?.getAttribute('aria-label')).toBe('Your membership tier');
    expect(help()?.getAttribute('title')).toBe('Your membership tier');
    expect(help()?.className).toContain('fa-circle-question');
  });
});
