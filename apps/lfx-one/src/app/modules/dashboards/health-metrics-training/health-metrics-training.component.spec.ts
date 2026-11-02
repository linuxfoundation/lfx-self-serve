// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, output, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';
import { HEALTH_METRICS_TRAINING_BLANK, HEALTH_METRICS_TRAINING_SECTIONS } from '@lfx-one/shared/constants';
import { ProjectContextService } from '@services/project-context.service';
import { UserService } from '@services/user.service';
import { BehaviorSubject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HealthMetricsChromeService } from '../health-metrics-gate/health-metrics-chrome.service';
import { TrainingCoursesComponent } from './components/training-courses/training-courses.component';
import { TrainingEnrollComponent } from './components/training-enroll/training-enroll.component';
import { HealthMetricsTrainingComponent } from './health-metrics-training.component';

/** Stands in for Enrollment & revenue, whose read its own spec covers; the test drives its outputs. */
@Component({ selector: 'lfx-training-enroll', template: '<div data-testid="training-enroll-stub"></div>' })
class EnrollStubComponent {
  public readonly settled = output<boolean | null>();
  public readonly reading = output<void>();
}

/** Stands in for Courses, whose read its own spec covers; the test drives its outputs. */
@Component({ selector: 'lfx-training-courses', template: '<div data-testid="training-courses-stub"></div>' })
class CoursesStubComponent {
  public readonly countChange = output<number | null>();
  public readonly settled = output<boolean | null>();
  public readonly reading = output<void>();
}

// Covers what Training wires into the shell; scroll-spy and the empty states are the shell's own spec.
describe('HealthMetricsTrainingComponent', () => {
  const originalScrollIntoView = Element.prototype.scrollIntoView;
  let fixture: ComponentFixture<HealthMetricsTrainingComponent>;
  let selectedFoundation: ReturnType<typeof signal<{ slug: string } | null>>;

  async function setup(initialFragment: string | null = null): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [HealthMetricsTrainingComponent],
      providers: [
        HealthMetricsChromeService,
        { provide: ProjectContextService, useValue: { selectedFoundation } },
        { provide: UserService, useValue: { impersonating: signal(false) } },
        { provide: ActivatedRoute, useValue: { fragment: new BehaviorSubject<string | null>(initialFragment).asObservable() } },
      ],
    })
      .overrideComponent(HealthMetricsTrainingComponent, {
        remove: { imports: [TrainingCoursesComponent, TrainingEnrollComponent] },
        add: { imports: [CoursesStubComponent, EnrollStubComponent] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(HealthMetricsTrainingComponent);
    await flush();
    await flush();
  }

  async function flush(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function stub<T>(type: new (...args: never[]) => T): T {
    return fixture.debugElement.query(By.directive(type)).componentInstance as T;
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

  it('renders both sections in order, each anchored with its design copy', async () => {
    await setup();
    const rendered = [...fixture.nativeElement.querySelectorAll('[data-testid^="training-section-"]')] as HTMLElement[];

    expect(rendered.map((element) => element.id)).toEqual(HEALTH_METRICS_TRAINING_SECTIONS.map((section) => `sec-trn-${section.key}`));
    rendered.forEach((element, index) => expect(element.textContent).toContain(HEALTH_METRICS_TRAINING_SECTIONS[index].heading));
  });

  it('projects each section into its anchor, leaving none awaiting data', async () => {
    await setup();

    expect(fixture.nativeElement.querySelector('#sec-trn-enroll [data-testid="training-enroll-stub"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('#sec-trn-courses [data-testid="training-courses-stub"]')).not.toBeNull();
    expect(testId('health-metrics-training-page')?.textContent).not.toContain('Awaiting data');
  });

  it('lists every section in the sub-nav, with no badge before a read', async () => {
    await setup();
    const nav = testId('training-sub-nav') as HTMLElement;

    for (const section of HEALTH_METRICS_TRAINING_SECTIONS) {
      expect(testId(`training-sub-nav-${section.key}`)?.textContent).toContain(section.label);
    }
    expect(nav.textContent).not.toMatch(/\d/);
  });

  it('badges Courses with the in-scope count it reports, and clears it while a read is pending', async () => {
    await setup();
    const courses = stub(CoursesStubComponent);

    courses.countChange.emit(340);
    await flush();
    expect(testId('training-sub-nav-courses')?.textContent).toContain('340');
    expect(testId('training-sub-nav-enroll')?.textContent).not.toMatch(/\d/);

    courses.countChange.emit(null);
    await flush();
    expect(testId('training-sub-nav-courses')?.textContent).not.toMatch(/\d/);
  });

  it('re-lands a held deep link as each data section settles, releasing it once both have', async () => {
    await setup('courses');
    const scrollIntoView = Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>;
    scrollIntoView.mockClear();

    const enroll = stub(EnrollStubComponent);
    enroll.settled.emit(false);
    await flush();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);

    stub(CoursesStubComponent).settled.emit(false);
    await flush();
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
    expect(fixture.nativeElement.querySelector('[aria-current="true"]').getAttribute('data-testid')).toBe('training-sub-nav-courses');

    scrollIntoView.mockClear();
    enroll.settled.emit(false);
    await flush();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('swaps the sections for the Training blank card once both settle empty', async () => {
    await setup();

    stub(EnrollStubComponent).settled.emit(true);
    stub(CoursesStubComponent).settled.emit(true);
    await flush();

    expect(testId('training-blank')?.querySelector('h2')?.textContent).toBe('No training data yet');
    expect(testId('training-blank-lead')?.textContent).toBe(HEALTH_METRICS_TRAINING_BLANK.lead);
    expect(testId('health-metrics-training-page')?.className).toContain('hidden');
  });

  it('keeps the sections when one of them has data', async () => {
    await setup();

    stub(EnrollStubComponent).settled.emit(true);
    stub(CoursesStubComponent).settled.emit(false);
    await flush();

    expect(testId('training-blank')).toBeNull();
    expect(testId('training-section-empty-enroll')).not.toBeNull();
  });
});
