// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';

import { HealthMetricsFootnoteComponent } from './health-metrics-footnote.component';

import type { HealthMetricsFootnotePart } from '@lfx-one/shared/interfaces';

const PARTS: HealthMetricsFootnotePart[] = [
  { text: 'Board & voting are included. The ' },
  { text: 'Members', route: 'members' },
  { text: ' section adds the ' },
  { text: 'governance-accurate', bold: true },
  { text: ' cut.' },
];

@Component({
  selector: 'lfx-projecting-host',
  imports: [HealthMetricsFootnoteComponent],
  template: `<lfx-health-metrics-footnote tone="caution"
    >Closed events are results. <button type="button">See the forecast</button></lfx-health-metrics-footnote
  >`,
})
class ProjectingHostComponent {}

describe('HealthMetricsFootnoteComponent', () => {
  let fixture: ComponentFixture<HealthMetricsFootnoteComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HealthMetricsFootnoteComponent, ProjectingHostComponent],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(HealthMetricsFootnoteComponent);
    fixture.componentRef.setInput('parts', PARTS);
    fixture.componentRef.setInput('tone', 'caution');
    await fixture.whenStable();
  });

  function note(): HTMLElement {
    return fixture.nativeElement.querySelector('[data-testid="health-metrics-footnote-note"]');
  }

  function label(): string | null {
    return note().querySelector('[data-testid="ui-note-label"]')?.textContent?.trim() ?? null;
  }

  // Each run carries its own spacing, so the rendered sentence is exactly the joined parts.
  it('renders the parts as one sentence with no spacing of its own', () => {
    expect(note().querySelector('[data-testid="ui-note-content"]')?.textContent?.trim()).toBe(PARTS.map((part) => part.text).join(''));
  });

  // A caution is the small warning note with its triangle and no label.
  it('renders a caution as a small warning note with no label', () => {
    expect(note().className).toContain('bg-ui-warning-50');
    expect(note().className).toContain('min-h-[32px]');
    expect(note().querySelector('[data-testid="ui-note-icon"] i')?.className).toContain('fa-triangle-exclamation');
    expect(label()).toBeNull();
  });

  it.each([
    ['healthy', 'bg-ui-success-50', 'Healthy:'],
    ['attention', 'bg-ui-warning-50', 'Needs attention:'],
    ['action', 'bg-ui-danger-50', 'Needs action:'],
    ['summary', 'bg-ui-neutral-50', 'Summary:'],
  ])('renders a %s verdict in its colour with its label', async (tone, fill, text) => {
    fixture.componentRef.setInput('tone', tone);
    await fixture.whenStable();

    expect(note().className).toContain(fill);
    expect(label()).toBe(text);
  });

  it('renders a bold run in bold and a routed run as a link to that tab', () => {
    expect(fixture.nativeElement.querySelector('b')?.textContent).toBe('governance-accurate');
    const link = fixture.nativeElement.querySelector('[data-testid="health-metrics-footnote-link-members"]') as HTMLAnchorElement;
    expect(link.textContent).toBe('Members');
    expect(link.getAttribute('href')).toBe('/foundation/health-metrics/members');
  });

  it('renders projected content after the parts, as the Organizations caution uses it', async () => {
    const host = TestBed.createComponent(ProjectingHostComponent);
    await host.whenStable();

    expect(host.nativeElement.textContent.trim()).toBe('Closed events are results. See the forecast');
    expect(host.nativeElement.querySelector('button')?.textContent).toBe('See the forecast');
  });
});
