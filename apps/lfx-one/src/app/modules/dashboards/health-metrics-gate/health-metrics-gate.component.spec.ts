// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { NgClass } from '@angular/common';
import { AnalyticsService } from '@services/analytics.service';
import { FeatureFlagService } from '@services/feature-flag.service';
import { ProjectContextService } from '@services/project-context.service';
import { UserService } from '@services/user.service';
import { PopoverModule } from 'primeng/popover';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { FoundationProjectsDetailGroupedResponse, ProjectContext, ProjectTableRow } from '@lfx-one/shared/interfaces';

import { HealthMetricsChromeService } from './health-metrics-chrome.service';
import { HealthMetricsGateComponent } from './health-metrics-gate.component';

// Stand-in for the real legacy page, matched by selector — keeps this spec from dragging in that
// page's full dependency tree; only the @if branching and the tab shell matter here.
@Component({ selector: 'lfx-health-metrics', template: '<div data-testid="legacy-stub"></div>' })
class LegacyStubComponent {}

@Component({ selector: 'lfx-route-stub', template: '' })
class RouteStubComponent {}

function projectsResponse(...projects: [string, string][]): FoundationProjectsDetailGroupedResponse {
  return {
    groups: [
      {
        foundationSlug: 'acme-foundation',
        foundationName: 'Acme Foundation',
        foundationUid: 'uid-1',
        projects: projects.map(([projectSlug, projectName]) => ({ projectSlug, projectName }) as ProjectTableRow),
      },
    ],
    totalCount: projects.length,
  };
}

describe('HealthMetricsGateComponent', () => {
  let fixture: ComponentFixture<HealthMetricsGateComponent>;
  const impersonating = signal(false);
  const selectedFoundation = signal<ProjectContext | null>({ slug: 'acme-foundation' } as ProjectContext);
  let loadFoundationProjectsDetailGrouped: ReturnType<typeof vi.fn>;

  async function render(
    overviewEnabled: WritableSignal<boolean>,
    url = '/',
    projects: FoundationProjectsDetailGroupedResponse = projectsResponse(['beta-mesh', 'Beta Mesh'], ['alpha', 'Alpha'])
  ): Promise<void> {
    loadFoundationProjectsDetailGrouped = vi.fn(() => of(projects));
    await TestBed.configureTestingModule({
      imports: [HealthMetricsGateComponent],
      providers: [
        provideRouter([{ path: '**', component: RouteStubComponent }]),
        provideNoopAnimations(),
        { provide: FeatureFlagService, useValue: { getBooleanFlag: () => overviewEnabled } },
        { provide: UserService, useValue: { impersonating } },
        { provide: ProjectContextService, useValue: { selectedFoundation } },
        { provide: AnalyticsService, useValue: { loadFoundationProjectsDetailGrouped } },
      ],
    })
      .overrideComponent(HealthMetricsGateComponent, {
        set: { imports: [NgClass, PopoverModule, RouterLink, RouterLinkActive, RouterOutlet, LegacyStubComponent] },
      })
      .compileComponents();

    await TestBed.inject(Router).navigateByUrl(url);
    fixture = TestBed.createComponent(HealthMetricsGateComponent);
    fixture.detectChanges();
    // Flushes the component's `afterNextRender` hydration latch — before it fires, `overviewEnabled`
    // is forced false regardless of the flag signal, matching the SSR-safe behavior under test.
    await fixture.whenStable();
    fixture.detectChanges();
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    impersonating.set(false);
    selectedFoundation.set({ slug: 'acme-foundation' } as ProjectContext);
  });

  function query(testId: string): HTMLElement | null {
    return fixture.nativeElement.ownerDocument.querySelector(`[data-testid="${testId}"]`);
  }

  async function settle(): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function currentUrl(): string {
    return TestBed.inject(Router).url;
  }

  it('renders the legacy page, and no tab shell at all, when the flag is off', async () => {
    await render(signal(false));

    expect(fixture.nativeElement.querySelector('[data-testid="legacy-stub"]')).not.toBeNull();
    // No outlet while the flag is off is what keeps a direct hit on `…/engagement` on the legacy page.
    expect(fixture.nativeElement.querySelector('router-outlet')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="health-metrics-tabs"]')).toBeNull();
  });

  it('renders the tab shell and an outlet when the flag is on', async () => {
    await render(signal(true));

    expect(fixture.nativeElement.querySelector('[data-testid="legacy-stub"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('router-outlet')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="health-metrics-tabs"]')).not.toBeNull();
  });

  it('swaps pages reactively when the flag signal changes after render', async () => {
    const overviewEnabled = signal(false);
    await render(overviewEnabled);

    overviewEnabled.set(true);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="health-metrics-tabs"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="legacy-stub"]')).toBeNull();
  });

  it('renders every tab, each linking to its Level 2 page', async () => {
    await render(signal(true));

    const labels = Array.from<Element>(fixture.nativeElement.querySelectorAll('[data-testid^="health-metrics-tab-"]')).map((el) => el.textContent?.trim());
    expect(labels).toEqual(['Overview', 'Engagement', 'Events', 'Members', 'Non-Members', 'Training']);

    expect(fixture.nativeElement.querySelector('[data-testid="health-metrics-tab-overview"]').getAttribute('href')).toBe('/foundation/health-metrics');
    expect(fixture.nativeElement.querySelector('[data-testid="health-metrics-tab-engagement"]').getAttribute('href')).toBe(
      '/foundation/health-metrics/engagement'
    );
    expect(fixture.nativeElement.querySelector('[data-testid="health-metrics-tab-events"]').getAttribute('href')).toBe('/foundation/health-metrics/events');
    expect(fixture.nativeElement.querySelector('[data-testid="health-metrics-tab-members"]').getAttribute('href')).toBe('/foundation/health-metrics/members');
    expect(fixture.nativeElement.querySelector('[data-testid="health-metrics-tab-non-members"]').getAttribute('href')).toBe(
      '/foundation/health-metrics/non-members'
    );
    expect(fixture.nativeElement.querySelector('[data-testid="health-metrics-tab-training"]').getAttribute('href')).toBe('/foundation/health-metrics/training');
  });

  it('measures the sticky header via ResizeObserver and publishes it as the shared sticky offset', async () => {
    let observedCallback: ResizeObserverCallback | undefined;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        public constructor(callback: ResizeObserverCallback) {
          observedCallback = callback;
        }
        public observe(): void {
          /* no-op — the fake reports height only via the manually-invoked callback below */
        }
        public disconnect(): void {
          /* no-op */
        }
      }
    );

    await render(signal(true));

    expect(observedCallback).toBeDefined();
    observedCallback?.([{ borderBoxSize: [{ blockSize: 120 }] } as unknown as ResizeObserverEntry], {} as ResizeObserver);

    const chrome = fixture.debugElement.injector.get(HealthMetricsChromeService);
    expect(chrome.headerHeightPx()).toBe(120);
    expect(chrome.stickyTopPx()).toBe(136);
  });

  it('never observes the header while the flag is off, since the header is not rendered', async () => {
    let constructed = 0;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        public constructor() {
          constructed += 1;
        }
        public observe(): void {
          /* no-op */
        }
        public disconnect(): void {
          /* no-op */
        }
      }
    );

    await render(signal(false));

    expect(constructed).toBe(0);
  });

  it('pins the header below the fixed impersonation banner while impersonating', async () => {
    impersonating.set(true);
    await render(signal(true));

    const header = fixture.nativeElement.querySelector('header');
    expect(header.className).toContain('lg:top-12');
    expect(header.className).not.toContain('lg:top-0');
  });

  describe('project selector', () => {
    it('never fetches the project list while the flag is off', async () => {
      await render(signal(false), '/foundation/health-metrics/engagement');

      expect(loadFoundationProjectsDetailGrouped).not.toHaveBeenCalled();
    });

    it('stays inert on a tab that does not follow it', async () => {
      await render(signal(true), '/foundation/health-metrics?projectScope=alpha');

      const trigger = query('health-metrics-overview-project-selector');
      expect(trigger?.getAttribute('aria-disabled')).toBe('true');
      expect(query('health-metrics-project-selector-label')?.textContent?.trim()).toBe('All projects');

      trigger?.click();
      await settle();
      expect(query('health-metrics-project-menu')).toBeNull();
    });

    it('lists all projects first, then the foundation projects by name, and writes the pick to the URL', async () => {
      await render(signal(true), '/foundation/health-metrics/engagement#committees');

      const trigger = query('health-metrics-overview-project-selector');
      expect(trigger?.getAttribute('aria-disabled')).toBeNull();
      expect(loadFoundationProjectsDetailGrouped).toHaveBeenCalledWith('acme-foundation');

      trigger?.click();
      await settle();
      const options = Array.from(query('health-metrics-project-menu')?.querySelectorAll('[role="option"] .flex-1') ?? []).map((el) => el.textContent?.trim());
      expect(options).toEqual(['All projects', 'Alpha', 'Beta Mesh']);

      query('health-metrics-project-option-beta-mesh')?.click();
      await settle();

      expect(currentUrl()).toBe('/foundation/health-metrics/engagement?projectScope=beta-mesh#committees');
      expect(fixture.debugElement.injector.get(HealthMetricsChromeService).selectedProjectSlug()).toBe('beta-mesh');
      expect(query('health-metrics-project-selector-label')?.textContent?.trim()).toBe('Beta Mesh');
    });

    it('reads the selection off the URL and clears it again on all projects', async () => {
      await render(signal(true), '/foundation/health-metrics/engagement?projectScope=alpha&groupPage=2');
      await settle();

      expect(query('health-metrics-project-selector-label')?.textContent?.trim()).toBe('Alpha');

      query('health-metrics-overview-project-selector')?.click();
      await settle();
      query('health-metrics-project-option-all')?.click();
      await settle();

      expect(currentUrl()).toBe('/foundation/health-metrics/engagement?groupPage=2');
      expect(fixture.debugElement.injector.get(HealthMetricsChromeService).selectedProjectSlug()).toBeNull();
    });

    it('drops a slug the foundation does not carry', async () => {
      await render(signal(true), '/foundation/health-metrics/engagement?projectScope=unknown-project');
      await settle();

      expect(currentUrl()).toBe('/foundation/health-metrics/engagement');
    });

    it('ignores a malformed slug rather than reading with it', async () => {
      await render(signal(true), '/foundation/health-metrics/engagement?projectScope=Not%20A%20Slug');

      expect(fixture.debugElement.injector.get(HealthMetricsChromeService).selectedProjectSlug()).toBeNull();
    });

    it('resets to all projects when the foundation changes', async () => {
      await render(signal(true), '/foundation/health-metrics/engagement?projectScope=alpha');
      await settle();

      loadFoundationProjectsDetailGrouped.mockReturnValue(of(projectsResponse(['alpha', 'Alpha'])));
      selectedFoundation.set({ slug: 'other-foundation' } as ProjectContext);
      await settle();

      expect(currentUrl()).toBe('/foundation/health-metrics/engagement');
      expect(loadFoundationProjectsDetailGrouped).toHaveBeenLastCalledWith('other-foundation');
    });

    it('leaves the app-wide project context param alone', async () => {
      await render(signal(true), '/foundation/health-metrics/engagement?project=acme-foundation');
      await settle();

      expect(fixture.debugElement.injector.get(HealthMetricsChromeService).selectedProjectSlug()).toBeNull();
      expect(currentUrl()).toBe('/foundation/health-metrics/engagement?project=acme-foundation');
    });

    it('keeps the selection through a failed list load and retries on click', async () => {
      await render(signal(true), '/foundation/health-metrics/engagement?projectScope=alpha');
      loadFoundationProjectsDetailGrouped.mockReturnValue(throwError(() => new Error('upstream failed')));
      selectedFoundation.set({ slug: 'other-foundation' } as ProjectContext);
      await settle();
      await TestBed.inject(Router).navigateByUrl('/foundation/health-metrics/engagement?projectScope=alpha');
      await settle();

      const chrome = fixture.debugElement.injector.get(HealthMetricsChromeService);
      expect(chrome.projectsFailed()).toBe(true);
      expect(chrome.selectedProjectSlug()).toBe('alpha');
      expect(currentUrl()).toBe('/foundation/health-metrics/engagement?projectScope=alpha');
      expect(query('health-metrics-project-selector-label')?.textContent?.trim()).toBe('alpha');
      expect(query('health-metrics-project-selector-retry')).not.toBeNull();

      loadFoundationProjectsDetailGrouped.mockReturnValue(of(projectsResponse(['alpha', 'Alpha'])));
      query('health-metrics-overview-project-selector')?.click();
      await settle();

      expect(loadFoundationProjectsDetailGrouped).toHaveBeenLastCalledWith('other-foundation');
      expect(chrome.projectsFailed()).toBe(false);
      expect(query('health-metrics-project-selector-label')?.textContent?.trim()).toBe('Alpha');
      expect(query('health-metrics-project-menu')).toBeNull();
    });

    it('drops a kept slug only once a retried list loads without it', async () => {
      selectedFoundation.set({ slug: 'other-foundation' } as ProjectContext);
      await render(signal(true), '/foundation/health-metrics/engagement?projectScope=alpha');
      loadFoundationProjectsDetailGrouped.mockReturnValue(throwError(() => new Error('upstream failed')));
      selectedFoundation.set({ slug: 'third-foundation' } as ProjectContext);
      await settle();
      await TestBed.inject(Router).navigateByUrl('/foundation/health-metrics/engagement?projectScope=alpha');
      await settle();
      expect(currentUrl()).toBe('/foundation/health-metrics/engagement?projectScope=alpha');

      loadFoundationProjectsDetailGrouped.mockReturnValue(of(projectsResponse(['beta-mesh', 'Beta Mesh'])));
      query('health-metrics-overview-project-selector')?.click();
      await settle();

      expect(currentUrl()).toBe('/foundation/health-metrics/engagement');
    });

    it('hides the pill once the foundation turns out to have no projects', async () => {
      await render(signal(true), '/foundation/health-metrics/engagement', projectsResponse());

      expect(query('health-metrics-overview-project-selector')).toBeNull();
    });
  });
});
