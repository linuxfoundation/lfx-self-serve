// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ProjectContextService } from '@services/project-context.service';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HealthMetricsOverviewComponent } from './health-metrics-overview.component';

import type { HealthMetricsAreaState, HealthMetricsFinding, ProjectContext } from '@lfx-one/shared/interfaces';

describe('HealthMetricsOverviewComponent', () => {
  let fixture: ComponentFixture<HealthMetricsOverviewComponent>;

  /** Returns the foundation signal so a test can switch foundations without re-wiring the TestBed. */
  async function render(foundation: ProjectContext | null, foundationSfid: string | null): Promise<WritableSignal<ProjectContext | null>> {
    const foundationSignal = signal<ProjectContext | null>(foundation);
    await TestBed.configureTestingModule({
      imports: [HealthMetricsOverviewComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ProjectContextService,
          useValue: { selectedFoundation: foundationSignal, selectedFoundationSfid: signal(foundationSfid) },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(HealthMetricsOverviewComponent);
    fixture.detectChanges();

    return foundationSignal;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('measures the sticky header via ResizeObserver and feeds its height into the rail offset', async () => {
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

    await render(null, null);
    // afterNextRender (which calls observeHeaderHeight) only fires once the render is stable.
    await fixture.whenStable();
    fixture.detectChanges();

    expect(observedCallback).toBeDefined();
    observedCallback?.([{ borderBoxSize: [{ blockSize: 120 }] } as unknown as ResizeObserverEntry], {} as ResizeObserver);
    fixture.detectChanges();

    const rail: HTMLElement = fixture.nativeElement.querySelector('[data-testid="health-metrics-overview-rail"]');
    expect(rail.style.top).toBe('136px'); // headerHeightPx (120) + 16, per railTopPx()
  });

  it('renders findings groups in the fixed order', async () => {
    await render(null, null);

    const groupEls = fixture.nativeElement.querySelectorAll('[data-testid^="health-metrics-overview-findings-group-"]');
    const order = Array.from<Element>(groupEls).map((el) => el.getAttribute('data-testid'));
    expect(order).toEqual([
      'health-metrics-overview-findings-group-act',
      'health-metrics-overview-findings-group-watch',
      'health-metrics-overview-findings-group-opp',
      'health-metrics-overview-findings-group-ok',
      'health-metrics-overview-findings-group-none',
    ]);
  });

  it('sorts findings within a group by sortRank', async () => {
    await render(null, null);

    const rows = fixture.nativeElement.querySelectorAll(
      '[data-testid="health-metrics-overview-findings-group-act"] [data-testid^="health-metrics-overview-finding-row-"]'
    );
    const ranks = Array.from<Element>(rows).map((el) => Number(el.getAttribute('data-testid')?.split('-').pop()));
    expect(ranks.length).toBeGreaterThan(1);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it('builds an external Insights link for the code area, not a PCC link', async () => {
    await render({ uid: 'proj-uid', name: 'Test Foundation', slug: 'test-foundation' }, 'a0912345678901234A');

    const codeTile = fixture.nativeElement.querySelector('[data-testid="health-metrics-overview-tile-code"]');
    const insightsLink: HTMLAnchorElement | null = codeTile.querySelector('[data-testid="health-metrics-overview-tile-insights-link"]');
    expect(insightsLink?.href).toContain('insights.linuxfoundation.org/collection/details/test-foundation');
  });

  it('resolves a PCC finding link from the Salesforce id, not the project uid', async () => {
    await render({ uid: 'proj-uid', name: 'Test Foundation', slug: 'test-foundation' }, 'a0912345678901234A');

    const link: HTMLAnchorElement | null = fixture.nativeElement.querySelector('a[data-testid^="health-metrics-overview-finding-link-"][target="_self"]');
    expect(link?.href).toContain('/project/a0912345678901234A/');
    expect(link?.href).not.toContain('proj-uid');
  });

  it('hides a PCC finding link while the Salesforce id has not resolved yet', async () => {
    await render({ uid: 'proj-uid', name: 'Test Foundation', slug: 'test-foundation' }, null);

    // The code.insights finding link has nothing to do with the SFID and should still render —
    // only the PCC-bound links (target="_self") are expected to disappear.
    const insightsFindingLink = fixture.nativeElement.querySelector('a[data-testid^="health-metrics-overview-finding-link-"][target="_blank"]');
    expect(insightsFindingLink).not.toBeNull();

    const pccLinks = fixture.nativeElement.querySelectorAll('a[data-testid^="health-metrics-overview-finding-link-"][target="_self"]');
    expect(pccLinks.length).toBe(0);
  });

  function areaState(overrides: Partial<HealthMetricsAreaState> = {}): HealthMetricsAreaState {
    return {
      area: 'eng',
      statValue: '8 of 31',
      statLabel: 'below 50%',
      statSource: 'engagement',
      classification: 'act',
      evaluatedAt: '2026-09-01',
      ...overrides,
    };
  }

  function finding(overrides: Partial<HealthMetricsFinding> = {}): HealthMetricsFinding {
    return {
      classification: 'act',
      area: 'eng',
      title: 'Some finding',
      sentence: 'Plain sentence.',
      keyValue: '8 of 31',
      keyLabel: 'below 50%',
      linkTarget: 'eng.participation',
      sortRank: 10,
      evaluatedAt: '2026-09-01',
      ...overrides,
    };
  }

  it('renders the all-clear state and no group elements when there are no findings', async () => {
    await render(null, null);
    fixture.componentRef.setInput('findings', []);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="health-metrics-overview-all-clear"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelectorAll('[data-testid^="health-metrics-overview-findings-group-"]').length).toBe(0);
  });

  it('renders only the group headers for classifications present in the findings', async () => {
    await render(null, null);
    fixture.componentRef.setInput('findings', [finding({ classification: 'act', sortRank: 1 }), finding({ classification: 'ok', sortRank: 2 })]);
    fixture.detectChanges();

    const groupEls = fixture.nativeElement.querySelectorAll('[data-testid^="health-metrics-overview-findings-group-"]');
    expect(Array.from<Element>(groupEls).map((el) => el.getAttribute('data-testid'))).toEqual([
      'health-metrics-overview-findings-group-act',
      'health-metrics-overview-findings-group-ok',
    ]);
  });

  describe('KPI tile strip wiring', () => {
    it('renders the live classification and stat for an area once the KPI fetch resolves', async () => {
      await render({ uid: 'proj-uid', name: 'Test Foundation', slug: 'test-foundation' }, 'a0912345678901234A');
      const httpMock = TestBed.inject(HttpTestingController);
      httpMock
        .expectOne((r) => r.url === '/api/analytics/foundation-profile-summary')
        .flush({ projects: 14, tiers: '4 tiers', board: '12 seats', nextRenewals: '5 in the next 90 days' });
      httpMock.expectOne((r) => r.url === '/api/analytics/health-overview-revenue').flush({ YTD: { dataAvailable: true, total: 100, streams: [] } });
      httpMock
        .expectOne((r) => r.url === '/api/analytics/health-overview-kpis')
        .flush({ YTD: [areaState({ area: 'evt', statValue: '81%', statLabel: 'of registration goal', classification: 'ok' })] });
      await fixture.whenStable();

      const evtTile = fixture.nativeElement.querySelector('[data-testid="health-metrics-overview-tile-evt"]');
      expect(evtTile.textContent).toContain('81%');
      expect(evtTile.textContent).toContain('Going well');
      httpMock.verify();
    });

    it('hides the status chip for the events tile when showStatus is false, instead of showing "Awaiting data"', async () => {
      await render({ uid: 'proj-uid', name: 'Test Foundation', slug: 'test-foundation' }, 'a0912345678901234A');
      const httpMock = TestBed.inject(HttpTestingController);
      httpMock
        .expectOne((r) => r.url === '/api/analytics/foundation-profile-summary')
        .flush({ projects: 14, tiers: '4 tiers', board: '12 seats', nextRenewals: '5 in the next 90 days' });
      httpMock.expectOne((r) => r.url === '/api/analytics/health-overview-revenue').flush({ YTD: { dataAvailable: true, total: 100, streams: [] } });
      httpMock
        .expectOne((r) => r.url === '/api/analytics/health-overview-kpis')
        .flush({ YTD: [areaState({ area: 'evt', statValue: '—', statLabel: 'no registration goal set', classification: 'none', showStatus: false })] });
      await fixture.whenStable();

      const evtTile = fixture.nativeElement.querySelector('[data-testid="health-metrics-overview-tile-evt"]');
      expect(evtTile.textContent).toContain('no registration goal set');
      expect(evtTile.textContent).not.toContain('Awaiting data');
      httpMock.verify();
    });

    it('shows a neutral "no data" tile, not the fabricated fixture, for a live area when the KPI fetch fails', async () => {
      await render({ uid: 'proj-uid', name: 'Test Foundation', slug: 'test-foundation' }, 'a0912345678901234A');
      const httpMock = TestBed.inject(HttpTestingController);
      httpMock
        .expectOne((r) => r.url === '/api/analytics/foundation-profile-summary')
        .flush({ projects: 14, tiers: '4 tiers', board: '12 seats', nextRenewals: '5 in the next 90 days' });
      httpMock.expectOne((r) => r.url === '/api/analytics/health-overview-revenue').flush({ YTD: { dataAvailable: true, total: 100, streams: [] } });
      const kpiRequest = httpMock.expectOne((r) => r.url === '/api/analytics/health-overview-kpis');
      fixture.detectChanges();

      // Before the fetch resolves, the loading branch of buildNeutralKpiAreaState renders "loading…",
      // not "no data this period" — assert this pre-flush so a regression that only shows the
      // post-flush failure state can't silently swap the two.
      const evtTileLoading = fixture.nativeElement.querySelector('[data-testid="health-metrics-overview-tile-evt"]');
      expect(evtTileLoading.textContent).toContain('loading…');

      kpiRequest.error(new ProgressEvent('error'));
      await fixture.whenStable();

      // AnalyticsService.getHealthOverviewKpis degrades to an empty per-range map on failure. All 6 tiles still render —
      // eng from the fixture (this table never covers that area), but evt/trn/mem/non/code get a
      // neutral "no data" row rather than the fixture's fabricated numbers, since those would look
      // like real data.
      const tileStrip = fixture.nativeElement.querySelector('[data-testid="health-metrics-overview-tile-strip"]');
      expect(tileStrip.children.length).toBe(6);
      const evtTile = fixture.nativeElement.querySelector('[data-testid="health-metrics-overview-tile-evt"]');
      expect(evtTile.textContent).toContain('no data this period');
      // A never-evaluated tile must not claim to be "as of" today — that would fabricate freshness.
      expect(evtTile.textContent).not.toContain('as of');
      const codeTile = fixture.nativeElement.querySelector('[data-testid="health-metrics-overview-tile-code"]');
      expect(codeTile.textContent).toContain('no data this period');
      httpMock.verify();
    });

    it('clears the previous foundation tiles while the new foundation KPI fetch is in flight', async () => {
      const foundationSignal = await render({ uid: 'proj-uid', name: 'Test Foundation', slug: 'test-foundation' }, 'a0912345678901234A');
      const httpMock = TestBed.inject(HttpTestingController);
      httpMock
        .expectOne((r) => r.url === '/api/analytics/foundation-profile-summary')
        .flush({ projects: 14, tiers: '4 tiers', board: '12 seats', nextRenewals: '5 in the next 90 days' });
      httpMock.expectOne((r) => r.url === '/api/analytics/health-overview-revenue').flush({ YTD: { dataAvailable: true, total: 100, streams: [] } });
      httpMock
        .expectOne((r) => r.url === '/api/analytics/health-overview-kpis')
        .flush({ YTD: [areaState({ area: 'evt', statValue: '81%', statLabel: 'of registration goal', classification: 'ok' })] });
      await fixture.whenStable();
      expect(fixture.nativeElement.querySelector('[data-testid="health-metrics-overview-tile-evt"]').textContent).toContain('81%');

      foundationSignal.set({ uid: 'other-uid', name: 'Other Foundation', slug: 'other-foundation' });
      fixture.detectChanges();

      // mergeAreaStates prefers any live row over the loading placeholder, so without clearing the map
      // on a slug change the strip keeps showing the previous foundation's figures as if they were this one's.
      const evtTile = fixture.nativeElement.querySelector('[data-testid="health-metrics-overview-tile-evt"]');
      expect(evtTile.textContent).not.toContain('81%');
      expect(evtTile.textContent).toContain('loading…');

      httpMock
        .expectOne((r) => r.url === '/api/analytics/foundation-profile-summary')
        .flush({ projects: 2, tiers: '2 tiers', board: '1 seat', nextRenewals: '0 in the next 90 days' });
      httpMock.expectOne((r) => r.url === '/api/analytics/health-overview-revenue').flush({ YTD: { dataAvailable: true, total: 50, streams: [] } });
      httpMock
        .expectOne((r) => r.url === '/api/analytics/health-overview-kpis')
        .flush({ YTD: [areaState({ area: 'evt', statValue: '42%', statLabel: 'of registration goal', classification: 'watch' })] });
      await fixture.whenStable();

      expect(fixture.nativeElement.querySelector('[data-testid="health-metrics-overview-tile-evt"]').textContent).toContain('42%');
      httpMock.verify();
    });

    it('projects the clicked period out of the already-fetched KPI map without issuing any new request', async () => {
      await render({ uid: 'proj-uid', name: 'Test Foundation', slug: 'test-foundation' }, 'a0912345678901234A');
      const httpMock = TestBed.inject(HttpTestingController);
      httpMock
        .expectOne((r) => r.url === '/api/analytics/foundation-profile-summary')
        .flush({ projects: 14, tiers: '4 tiers', board: '12 seats', nextRenewals: '5 in the next 90 days' });
      httpMock.expectOne((r) => r.url === '/api/analytics/health-overview-revenue').flush({ YTD: { dataAvailable: true, total: 100, streams: [] } });
      // The `range` assertion is the endpoint contract this PR establishes: the fetch is per
      // foundation, so a period pill must never reintroduce a range param.
      httpMock
        .expectOne((r) => r.url === '/api/analytics/health-overview-kpis' && !r.params.has('range'))
        .flush({
          YTD: [areaState({ area: 'evt', statValue: '81%', statLabel: 'of registration goal', classification: 'ok' })],
          COMPLETED_YEAR: [areaState({ area: 'evt', statValue: '54%', statLabel: 'of registration goal', classification: 'watch' })],
        });
      await fixture.whenStable();
      expect(fixture.nativeElement.querySelector('[data-testid="health-metrics-overview-tile-evt"]').textContent).toContain('81%');

      // Recomputed from the real clock, not hardcoded, so this doesn't go stale across a year rollover.
      const lastCompletedYearLabel = String(new Date().getFullYear() - 1);
      fixture.nativeElement.querySelector(`[data-testid="health-metrics-overview-period-${lastCompletedYearLabel}"]`).click();
      fixture.detectChanges();

      // A wrong range key would render '—'/"no data this period", which reads as a legitimate empty
      // state rather than a bug — so assert the prior-year value specifically.
      const evtTile = fixture.nativeElement.querySelector('[data-testid="health-metrics-overview-tile-evt"]');
      expect(evtTile.textContent).toContain('54%');
      expect(evtTile.textContent).toContain('Needs attention');
      expect(evtTile.textContent).not.toContain('81%');
      httpMock.verify();
    });

    it('falls back to the neutral no-data tile for a period the fetched KPI map has no entry for', async () => {
      await render({ uid: 'proj-uid', name: 'Test Foundation', slug: 'test-foundation' }, 'a0912345678901234A');
      const httpMock = TestBed.inject(HttpTestingController);
      httpMock
        .expectOne((r) => r.url === '/api/analytics/foundation-profile-summary')
        .flush({ projects: 14, tiers: '4 tiers', board: '12 seats', nextRenewals: '5 in the next 90 days' });
      httpMock.expectOne((r) => r.url === '/api/analytics/health-overview-revenue').flush({ YTD: { dataAvailable: true, total: 100, streams: [] } });
      httpMock
        .expectOne((r) => r.url === '/api/analytics/health-overview-kpis')
        .flush({ YTD: [areaState({ area: 'evt', statValue: '81%', statLabel: 'of registration goal', classification: 'ok' })] });
      await fixture.whenStable();

      const lastCompletedYearLabel = String(new Date().getFullYear() - 1);
      fixture.nativeElement.querySelector(`[data-testid="health-metrics-overview-period-${lastCompletedYearLabel}"]`).click();
      fixture.detectChanges();

      // Covers the `?? []` in kpiAreaStates: a period the map doesn't carry must degrade to the neutral
      // row, never keep rendering the previously selected period's figures under the new label.
      const evtTile = fixture.nativeElement.querySelector('[data-testid="health-metrics-overview-tile-evt"]');
      expect(evtTile.textContent).toContain('no data this period');
      expect(evtTile.textContent).not.toContain('81%');
      httpMock.verify();
    });

    it('keeps the tiles and revenue rail loading, and issues no request, while no foundation is selected', async () => {
      await render(null, null);
      const httpMock = TestBed.inject(HttpTestingController);
      fixture.detectChanges();

      // The empty-slug guard: an unresolved foundation must read as "still loading", not as the
      // terminal "no data this period" / "revenue unavailable" states for data never fetched.
      const evtTile = fixture.nativeElement.querySelector('[data-testid="health-metrics-overview-tile-evt"]');
      expect(evtTile.textContent).toContain('loading…');
      expect(evtTile.textContent).not.toContain('no data this period');
      expect(fixture.nativeElement.querySelector('[data-testid="health-metrics-overview-revenue-skeleton"]')).not.toBeNull();
      expect(fixture.nativeElement.querySelector('[data-testid="health-metrics-overview-revenue-unavailable"]')).toBeNull();
      httpMock.verify();
    });
  });

  describe('foundation summary rail wiring', () => {
    it('sends the selected foundation slug and renders the fetched values in the rail', async () => {
      await render({ uid: 'proj-uid', name: 'Test Foundation', slug: 'test-foundation' }, 'a0912345678901234A');
      const httpMock = TestBed.inject(HttpTestingController);

      expect(fixture.nativeElement.querySelector('[data-testid="health-metrics-overview-foundation-summary-skeleton"]')).not.toBeNull();

      httpMock
        .expectOne((r) => r.url === '/api/analytics/foundation-profile-summary' && r.params.get('foundationSlug') === 'test-foundation')
        .flush({ projects: 14, tiers: '4 tiers', board: '12 seats', nextRenewals: '5 in the next 90 days' });
      httpMock.expectOne((r) => r.url === '/api/analytics/health-overview-revenue').flush({ YTD: { dataAvailable: true, total: 100, streams: [] } });
      httpMock.expectOne((r) => r.url === '/api/analytics/health-overview-kpis').flush({});
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('[data-testid="health-metrics-overview-foundation-summary-skeleton"]')).toBeNull();
      expect(fixture.nativeElement.textContent).toContain('4 tiers');
      httpMock.verify();
    });

    it('re-fetches the foundation summary when the selected foundation changes', async () => {
      const foundationSignal = await render({ uid: 'proj-uid', name: 'Test Foundation', slug: 'test-foundation' }, 'a0912345678901234A');
      const httpMock = TestBed.inject(HttpTestingController);
      httpMock
        .expectOne((r) => r.url === '/api/analytics/foundation-profile-summary' && r.params.get('foundationSlug') === 'test-foundation')
        .flush({ projects: 14, tiers: '4 tiers', board: '12 seats', nextRenewals: '5 in the next 90 days' });
      httpMock.expectOne((r) => r.url === '/api/analytics/health-overview-revenue').flush({ YTD: { dataAvailable: true, total: 100, streams: [] } });
      httpMock.expectOne((r) => r.url === '/api/analytics/health-overview-kpis').flush({});

      foundationSignal.set({ uid: 'other-uid', name: 'Other Foundation', slug: 'other-foundation' });
      fixture.detectChanges();

      httpMock
        .expectOne((r) => r.url === '/api/analytics/foundation-profile-summary' && r.params.get('foundationSlug') === 'other-foundation')
        .flush({ projects: 2, tiers: '2 tiers', board: '1 seat', nextRenewals: '0 in the next 90 days' });
      httpMock.expectOne((r) => r.url === '/api/analytics/health-overview-revenue').flush({ YTD: { dataAvailable: true, total: 50, streams: [] } });
      httpMock.expectOne((r) => r.url === '/api/analytics/health-overview-kpis').flush({});
      fixture.detectChanges();

      expect(fixture.nativeElement.textContent).toContain('2 tiers');
      httpMock.verify();
    });
  });

  describe('revenue rail wiring', () => {
    async function renderWithFoundation(): Promise<HttpTestingController> {
      await render({ uid: 'proj-uid', name: 'Test Foundation', slug: 'test-foundation' }, 'a0912345678901234A');
      const httpMock = TestBed.inject(HttpTestingController);
      httpMock
        .expectOne((r) => r.url === '/api/analytics/foundation-profile-summary')
        .flush({ projects: 14, tiers: '4 tiers', board: '12 seats', nextRenewals: '5 in the next 90 days' });
      httpMock.expectOne((r) => r.url === '/api/analytics/health-overview-kpis').flush({});
      return httpMock;
    }

    it('shows the rail skeleton before the revenue fetch resolves, then the real content after', async () => {
      const httpMock = await renderWithFoundation();

      expect(fixture.nativeElement.querySelector('[data-testid="health-metrics-overview-revenue-skeleton"]')).not.toBeNull();

      httpMock.expectOne((r) => r.url === '/api/analytics/health-overview-revenue').flush({ YTD: { dataAvailable: true, total: 100, streams: [] } });
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('[data-testid="health-metrics-overview-revenue-skeleton"]')).toBeNull();
      httpMock.verify();
    });

    it('shows the unavailable message when the fetch resolves with dataAvailable false', async () => {
      const httpMock = await renderWithFoundation();

      httpMock.expectOne((r) => r.url === '/api/analytics/health-overview-revenue').flush({ YTD: { dataAvailable: false, total: 0, streams: [] } });
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('[data-testid="health-metrics-overview-revenue-unavailable"]')).not.toBeNull();
      httpMock.verify();
    });

    it('projects the clicked period out of the already-fetched map without issuing any new request', async () => {
      const httpMock = await renderWithFoundation();
      httpMock
        .expectOne((r) => r.url === '/api/analytics/health-overview-revenue' && !r.params.has('range'))
        .flush({
          YTD: { dataAvailable: true, total: 100, streams: [{ key: 'memberships', value: 100 }] },
          COMPLETED_YEAR: { dataAvailable: true, total: 200, streams: [{ key: 'memberships', value: 200 }] },
        });
      fixture.detectChanges();

      // Recomputed from the real clock, not hardcoded, so this doesn't go stale across a year rollover.
      const lastCompletedYearLabel = String(new Date().getFullYear() - 1);
      const button: HTMLButtonElement = fixture.nativeElement.querySelector(`[data-testid="health-metrics-overview-period-${lastCompletedYearLabel}"]`);
      button.click();
      fixture.detectChanges();

      expect(button.getAttribute('aria-pressed')).toBe('true');
      // The whole point of the all-periods read: switching period costs zero requests and never
      // blanks the rail back to its skeleton. httpMock.verify() below fails if anything was issued.
      expect(fixture.nativeElement.querySelector('[data-testid="health-metrics-overview-revenue-skeleton"]')).toBeNull();
      expect(fixture.nativeElement.textContent).toContain('$200');
      httpMock.verify();
    });

    it('falls back to the unavailable message for a period the fetched map has no entry for', async () => {
      const httpMock = await renderWithFoundation();
      httpMock.expectOne((r) => r.url === '/api/analytics/health-overview-revenue').flush({ YTD: { dataAvailable: true, total: 100, streams: [] } });
      fixture.detectChanges();

      const lastCompletedYearLabel = String(new Date().getFullYear() - 1);
      fixture.nativeElement.querySelector(`[data-testid="health-metrics-overview-period-${lastCompletedYearLabel}"]`).click();
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('[data-testid="health-metrics-overview-revenue-unavailable"]')).not.toBeNull();
      httpMock.verify();
    });
  });
});
