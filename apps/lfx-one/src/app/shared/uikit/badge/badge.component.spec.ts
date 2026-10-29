// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { UiBadgeComponent } from './badge.component';

@Component({
  selector: 'lfx-ui-badge-test-host',
  imports: [UiBadgeComponent],
  template: `<lfx-ui-badge [tone]="'success'" [dot]="'success'" variant="outline"><svg slot="icon" data-testid="icon"></svg>Active</lfx-ui-badge>`,
})
class HostComponent {}

describe('UiBadgeComponent', () => {
  let fixture: ComponentFixture<UiBadgeComponent>;
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [UiBadgeComponent, HostComponent] }).compileComponents();
    fixture = TestBed.createComponent(UiBadgeComponent);
    host = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
  });

  it('is a 24px neutral subtle pill by default', () => {
    expect(host.className).toContain('h-ui-tiny');
    expect(host.className).toContain('px-[10px]');
    expect(host.className).toContain('text-label-12');
    expect(host.className).toContain('gap-[4px]');
    expect(host.className).toContain('bg-ui-neutral-100');
    expect(host.className).toContain('text-ui-neutral-900');
    expect(host.getAttribute('data-testid')).toBe('ui-badge');
  });

  it('is 20px tall with 11px text at the sm size', async () => {
    fixture.componentRef.setInput('size', 'sm');
    await fixture.whenStable();

    expect(host.className).toContain('h-[20px]');
    expect(host.className).toContain('text-[11px]');
    expect(host.className).toContain('leading-[16px]');
    expect(host.className).not.toContain('h-ui-tiny');
  });

  it.each([
    ['neutral', 'bg-ui-neutral-600'],
    ['accent', 'bg-ui-accent-500'],
    ['feature', 'bg-ui-feature-600'],
    ['danger', 'bg-ui-danger-600'],
    ['success', 'bg-ui-success-600'],
  ] as const)('fills the %s solid form with %s and white text', async (tone, fill) => {
    fixture.componentRef.setInput('variant', 'solid');
    fixture.componentRef.setInput('tone', tone);
    await fixture.whenStable();

    expect(host.className).toContain(fill);
    expect(host.className).toContain('text-white');
  });

  it('uses slate-900 ink, not white, on the solid warning fill', async () => {
    fixture.componentRef.setInput('variant', 'solid');
    fixture.componentRef.setInput('tone', 'warning');
    await fixture.whenStable();

    expect(host.className).toContain('bg-ui-warning-500');
    expect(host.className).toContain('text-ui-neutral-900');
    expect(host.className).not.toContain('text-white');
  });

  it.each([
    ['accent', 'bg-ui-accent-100', 'text-ui-accent-700'],
    ['feature', 'bg-ui-feature-100', 'text-ui-feature-700'],
    ['warning', 'bg-ui-warning-100', 'text-ui-warning-700'],
    ['danger', 'bg-ui-danger-100', 'text-ui-danger-700'],
    ['success', 'bg-ui-success-100', 'text-ui-success-700'],
  ] as const)('fills the %s subtle form with the 100 fill and 700 text', async (tone, fill, text) => {
    fixture.componentRef.setInput('tone', tone);
    await fixture.whenStable();

    expect(host.className).toContain(fill);
    expect(host.className).toContain(text);
  });

  it('draws the outline form as a ring on the page background, whatever the tone', async () => {
    fixture.componentRef.setInput('variant', 'outline');
    fixture.componentRef.setInput('tone', 'danger');
    await fixture.whenStable();

    expect(host.className).toContain('bg-ui-background-100');
    expect(host.className).toContain('edge');
    expect(host.className).not.toContain('bg-ui-danger');
  });

  it('shows a dot only when asked', async () => {
    expect(host.querySelector('[data-testid="ui-badge-dot"]')).toBeNull();

    fixture.componentRef.setInput('dot', 'success');
    await fixture.whenStable();

    const dot = host.querySelector('[data-testid="ui-badge-dot"]');
    expect(dot?.className).toContain('bg-ui-success-600');
    expect(dot?.getAttribute('aria-hidden')).toBe('true');
  });

  it('projects the leading icon and the text', async () => {
    const hostFixture = TestBed.createComponent(HostComponent);
    await hostFixture.whenStable();
    const el = hostFixture.nativeElement as HTMLElement;

    expect(el.querySelector('[data-testid="icon"]')).not.toBeNull();
    expect(el.textContent).toContain('Active');
    expect(el.querySelector('[data-testid="ui-badge-dot"]')).not.toBeNull();
  });
});
