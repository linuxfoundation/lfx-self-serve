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
  template: `<lfx-health-metrics-footnote>Closed events are results. <button type="button">See the forecast</button></lfx-health-metrics-footnote>`,
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
    await fixture.whenStable();
  });

  function icon(): HTMLElement {
    return fixture.nativeElement.querySelector('[data-testid="health-metrics-footnote-icon"]');
  }

  // Each run carries its own spacing, so the rendered sentence is exactly the joined parts.
  it('renders the parts as one sentence with no spacing of its own', () => {
    expect(fixture.nativeElement.textContent.trim()).toBe(PARTS.map((part) => part.text).join(''));
  });

  // The design's two note forms: plain grey text, or a warning icon on an amber panel.
  it('is plain grey text without an icon, and an amber panel with a warning icon on a caution note', async () => {
    const note = fixture.nativeElement.querySelector('p') as HTMLElement;
    expect(icon()).toBeNull();
    for (const cls of ['text-[12px]', 'text-gray-400']) expect(note.classList).toContain(cls);

    fixture.componentRef.setInput('caution', true);
    await fixture.whenStable();

    expect(icon().classList).toContain('fa-triangle-exclamation');
    for (const cls of ['bg-amber-50', 'text-amber-800']) expect(note.classList).toContain(cls);
    expect(note.classList).not.toContain('text-gray-400');
  });

  it('renders a bold run in bold and a routed run as a link to that tab', () => {
    expect(fixture.nativeElement.querySelector('b')?.textContent).toBe('governance-accurate');
    const link = fixture.nativeElement.querySelector('[data-testid="health-metrics-footnote-link-members"]') as HTMLAnchorElement;
    expect(link.textContent).toBe('Members');
    expect(link.getAttribute('href')).toBe('/foundation/health-metrics/members');
  });

  it('renders projected content after the parts, as the in-page link footnotes use it', async () => {
    const host = TestBed.createComponent(ProjectingHostComponent);
    await host.whenStable();

    expect(host.nativeElement.textContent.trim()).toBe('Closed events are results. See the forecast');
    expect(host.nativeElement.querySelector('button')?.textContent).toBe('See the forecast');
  });
});
