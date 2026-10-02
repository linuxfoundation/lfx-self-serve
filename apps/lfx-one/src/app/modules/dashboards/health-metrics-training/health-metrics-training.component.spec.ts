// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { HEALTH_METRICS_TRAINING_NO_PROGRAMME, HEALTH_METRICS_TRAINING_SECTIONS } from '@lfx-one/shared/constants';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { UserService } from '@services/user.service';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HealthMetricsChromeService } from '../health-metrics-gate/health-metrics-chrome.service';
import { HealthMetricsTrainingComponent } from './health-metrics-training.component';

import type { HealthMetricsTrainingPresence } from '@lfx-one/shared/interfaces';
import type { Observable } from 'rxjs';

// Covers the presence gate and what Training wires into the shell; scroll-spy is the shell's own spec.
describe('HealthMetricsTrainingComponent', () => {
  const originalScrollIntoView = Element.prototype.scrollIntoView;
  let fixture: ComponentFixture<HealthMetricsTrainingComponent>;
  let getTrainingPresence: ReturnType<typeof vi.fn>;
  let selectedFoundation: ReturnType<typeof signal<{ slug: string } | null>>;

  async function setup(presence: Observable<HealthMetricsTrainingPresence> = of({ hasProgramme: true }), initialFragment: string | null = null): Promise<void> {
    getTrainingPresence = vi.fn().mockReturnValue(presence);

    await TestBed.configureTestingModule({
      imports: [HealthMetricsTrainingComponent],
      providers: [
        HealthMetricsChromeService,
        { provide: AnalyticsService, useValue: { getTrainingPresence } },
        { provide: ProjectContextService, useValue: { selectedFoundation } },
        { provide: UserService, useValue: { impersonating: signal(false) } },
        { provide: ActivatedRoute, useValue: { fragment: new BehaviorSubject<string | null>(initialFragment).asObservable() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(HealthMetricsTrainingComponent);
    await flush();
    await flush();
  }

  async function flush(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function testId(id: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(`[data-testid="${id}"]`);
  }

  beforeEach(() => {
    selectedFoundation = signal<{ slug: string } | null>({ slug: 'acme' });
    // Not implemented in jsdom, and the deep-link path calls it on a real section element.
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    Element.prototype.scrollIntoView = originalScrollIntoView;
  });

  it('reads presence for the selected foundation only', async () => {
    await setup();

    expect(getTrainingPresence).toHaveBeenCalledTimes(1);
    expect(getTrainingPresence).toHaveBeenCalledWith({ foundationSlug: 'acme' });
  });

  it('renders both sections in order, each anchored with its design copy and awaiting data', async () => {
    await setup();
    const rendered = [...fixture.nativeElement.querySelectorAll('[data-testid^="training-section-"]')] as HTMLElement[];

    expect(rendered.map((element) => element.id)).toEqual(HEALTH_METRICS_TRAINING_SECTIONS.map((section) => `sec-trn-${section.key}`));
    rendered.forEach((element, index) => {
      expect(element.textContent).toContain(HEALTH_METRICS_TRAINING_SECTIONS[index].heading);
      expect(element.textContent).toContain('Awaiting data');
    });
  });

  it('lists every section in the sub-nav, with no badge and the Members cross-reference', async () => {
    await setup();
    const nav = testId('training-sub-nav') as HTMLElement;

    for (const section of HEALTH_METRICS_TRAINING_SECTIONS) {
      expect(testId(`training-sub-nav-${section.key}`)?.textContent).toContain(section.label);
    }
    expect(nav.textContent).not.toMatch(/\d/);
    expect(nav.textContent).toContain('Corporate training purchases appear per organization in');
    expect(testId('training-sub-nav-cross-reference-link')?.getAttribute('href')).toBe('/foundation/health-metrics/members#list');
  });

  it('says above the sections that the project selector does not narrow them', async () => {
    await setup();
    const note = testId('training-scope-note') as HTMLElement;

    expect(note.textContent).toContain('foundation-wide');
    expect(note.compareDocumentPosition(testId('health-metrics-training-page') as HTMLElement)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('lands a deep link on its section', async () => {
    await setup(of({ hasProgramme: true }), 'courses');

    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('[aria-current="true"]').getAttribute('data-testid')).toBe('training-sub-nav-courses');
  });

  it('holds the skeleton while presence is reading, then renders the shell', async () => {
    const presence = new Subject<HealthMetricsTrainingPresence>();
    await setup(presence);

    expect(testId('training-loading')).not.toBeNull();
    expect(testId('health-metrics-training-page')).toBeNull();

    presence.next({ hasProgramme: true });
    await flush();
    expect(testId('training-loading')).toBeNull();
    expect(testId('health-metrics-training-page')).not.toBeNull();
  });

  it('replaces the sections with one empty card when the foundation runs no training', async () => {
    await setup(of({ hasProgramme: false }));
    const card = testId('training-no-programme') as HTMLElement;

    expect(card.textContent).toContain(HEALTH_METRICS_TRAINING_NO_PROGRAMME.title);
    expect(card.textContent).toContain(HEALTH_METRICS_TRAINING_NO_PROGRAMME.body);
    expect(testId('training-no-programme-hint')?.textContent).toContain(HEALTH_METRICS_TRAINING_NO_PROGRAMME.hint);
    expect(testId('health-metrics-training-page')).toBeNull();
    expect(testId('training-scope-note')).toBeNull();
  });

  it('shows an error, not the no-training card, when the presence read fails', async () => {
    await setup(throwError(() => new Error('boom')));

    expect(testId('training-error')?.textContent).toContain('Training unavailable');
    expect(testId('training-no-programme')).toBeNull();
    expect(testId('health-metrics-training-page')).toBeNull();
  });

  it('re-reads when the foundation changes and holds the skeleton while none is selected', async () => {
    await setup();

    selectedFoundation.set(null);
    await flush();
    expect(testId('training-loading')).not.toBeNull();

    getTrainingPresence.mockReturnValue(of({ hasProgramme: false }));
    selectedFoundation.set({ slug: 'globex' });
    await flush();
    expect(getTrainingPresence).toHaveBeenLastCalledWith({ foundationSlug: 'globex' });
    expect(testId('training-no-programme')).not.toBeNull();
  });
});
