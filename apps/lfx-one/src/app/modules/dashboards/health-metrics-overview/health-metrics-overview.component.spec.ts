// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ProjectContextService } from '@services/project-context.service';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HealthMetricsOverviewComponent } from './health-metrics-overview.component';
import { HealthMetricsChromeService } from '../health-metrics-gate/health-metrics-chrome.service';

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
        provideRouter([]),
        // Normally provided by HealthMetricsGateComponent, which owns the sticky header and tab bar.
        HealthMetricsChromeService,
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

  /** The period pills live on the gate's header now, so tests drive the shared chrome state directly. */
  function selectPeriod(label: string): void {
    const chrome = TestBed.inject(HealthMetricsChromeService);
    const period = chrome.periods.find((candidate) => candidate.label === label);
    if (!period) throw new Error(`No period option labelled ${label}`);
    chrome.setPeriod(period);
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('pins the rail below the gate-measured sticky header height', async () => {
    await render(null, null);
    // The gate measures the header and publishes it here; the rail must follow it, not a constant.
    TestBed.inject(HealthMetricsChromeService).headerHeightPx.set(120);
    fixture.detectChanges();

    const rail: HTMLElement = fixture.nativeElement.querySelector('[data-testid="health-metrics-overview-rail"]');
    expect(rail.style.top).toBe('136px'); // headerHeightPx (120) + 16, per stickyTopPx()
  });

  it('renders findings groups in the fixed order', async () => {
    await render(null, null);
    fixture.componentRef.setInput('findings', sampleFindings());
    fixture.detectChanges();

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
    fixture.componentRef.setInput('findings', sampleFindings());
    fixture.detectChanges();

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
    fixture.componentRef.setInput('findings', sampleFindings());
    fixture.detectChanges();

    const link: HTMLAnchorElement | null = fixture.nativeElement.querySelector('a[data-testid^="health-metrics-overview-finding-link-"][target="_self"]');
    expect(link?.href).toContain('/project/a0912345678901234A/');
    expect(link?.href).not.toContain('proj-uid');
  });

  it('hides a PCC finding link while the Salesforce id has not resolved yet', async () => {
    await render({ uid: 'proj-uid', name: 'Test Foundation', slug: 'test-foundation' }, null);
    fixture.componentRef.setInput('findings', sampleFindings());
    fixture.detectChanges();

    // The code.insights finding link has nothing to do with the SFID and should still render —
    // only the PCC-bound links (target="_self") are expected to disappear.
    const insightsFindingLink = fixture.nativeElement.querySelector('a[data-testid^="health-metrics-overview-finding-link-"][target="_blank"]');
    expect(insightsFindingLink).not.toBeNull();

    const pccLinks = fixture.nativeElement.querySelectorAll('a[data-testid^="health-metrics-overview-finding-link-"][target="_self"]');
    expect(pccLinks.length).toBe(0);
  });

  it('links an Engagement finding into the Engagement tab even before the Salesforce id resolves', async () => {
    await render({ uid: 'proj-uid', name: 'Test Foundation', slug: 'test-foundation' }, null);
    fixture.componentRef.setInput('findings', [finding({ linkTarget: 'eng.board', sortRank: 7 })]);
    fixture.detectChanges();

    const link: HTMLAnchorElement = fixture.nativeElement.querySelector('[data-testid="health-metrics-overview-finding-link-7"]');
    expect(link.getAttribute('href')).toBe('/foundation/health-metrics/engagement?groupType=gov#committees');
    expect(link.getAttribute('target')).toBeNull();
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

  /** One finding per group, with two `act` rows out of rank order and one PCC-, Insights- and in-app link each. */
  function sampleFindings(): HealthMetricsFinding[] {
    return [
      finding({ classification: 'act', linkTarget: 'mem.atrisk', sortRank: 2 }),
      finding({ classification: 'act', linkTarget: 'eng.groups', sortRank: 1 }),
      finding({ classification: 'watch', area: 'evt', linkTarget: 'evt.forecast', sortRank: 3 }),
      finding({ classification: 'opp', area: 'non', linkTarget: 'non.orgs', sortRank: 4 }),
      finding({ classification: 'ok', area: 'code', linkTarget: 'code.insights', sortRank: 5 }),
      finding({ classification: 'none', area: 'trn', linkTarget: 'trn.enrollment', sortRank: 6 }),
    ];
  }

  it('renders a "not available yet" state, not an all-clear, when there are no findings', async () => {
    await render(null, null);

    const unavailable: HTMLElement | null = fixture.nativeElement.querySelector('[data-testid="health-metrics-overview-findings-unavailable"]');
    expect(unavailable?.textContent).toContain('Findings are not available yet.');
    expect(fixture.nativeElement.textContent).not.toContain('Nothing needs your attention');
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
        .flush({ dataAvailable: true, projects: '14', tiers: '4 tiers', board: '12 seats', nextRenewals: '5 in the next 90 days' });
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
        .flush({ dataAvailable: true, projects: '14', tiers: '4 tiers', board: '12 seats', nextRenewals: '5 in the next 90 days' });
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

    it('shows a neutral "no data" tile, never a placeholder figure, for a live area when the KPI fetch fails', async () => {
      await render({ uid: 'proj-uid', name: 'Test Foundation', slug: 'test-foundation' }, 'a0912345678901234A');
      const httpMock = TestBed.inject(HttpTestingController);
      httpMock
        .expectOne((r) => r.url === '/api/analytics/foundation-profile-summary')
        .flush({ dataAvailable: true, projects: '14', tiers: '4 tiers', board: '12 seats', nextRenewals: '5 in the next 90 days' });
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

      // AnalyticsService.getHealthOverviewKpis degrades to an empty per-range map on failure. All 6 tiles
      // still render, each as a neutral "no data" row rather than a placeholder figure.
      const tileStrip = fixture.nativeElement.querySelector('[data-testid="health-metrics-overview-tile-strip"]');
      expect(tileStrip.children.length).toBe(6);
      const evtTile = fixture.nativeElement.querySelector('[data-testid="health-metrics-overview-tile-evt"]');
      expect(evtTile.textContent).toContain('no data this period');
      // A never-evaluated tile must not claim to be "as of" today — that would fabricate freshness.
      expect(evtTile.textContent).not.toContain('as of');
      const codeTile = fixture.nativeElement.querySelector('[data-testid="health-metrics-overview-tile-code"]');
      expect(codeTile.textContent).toContain('no data this period');
      const engTile = fixture.nativeElement.querySelector('[data-testid="health-metrics-overview-tile-eng"]');
      expect(engTile.textContent).toContain('no data this period');
      expect(engTile.textContent).not.toContain('8 of 31');
      expect(engTile.textContent).not.toContain('View groups');
      // Engagement never shows a status chip, failed read included; other areas keep "Awaiting data".
      expect(engTile.textContent).not.toContain('Awaiting data');
      expect(evtTile.textContent).toContain('Awaiting data');
      httpMock.verify();
    });

    it('renders the live Engagement tile with its link to the Engagement tab and no status chip', async () => {
      await render({ uid: 'proj-uid', name: 'Test Foundation', slug: 'test-foundation' }, 'a0912345678901234A');
      const httpMock = TestBed.inject(HttpTestingController);
      httpMock
        .expectOne((r) => r.url === '/api/analytics/foundation-profile-summary')
        .flush({ dataAvailable: true, projects: '14', tiers: '4 tiers', board: '12 seats', nextRenewals: '5 in the next 90 days' });
      httpMock.expectOne((r) => r.url === '/api/analytics/health-overview-revenue').flush({ YTD: { dataAvailable: true, total: 100, streams: [] } });
      httpMock
        .expectOne((r) => r.url === '/api/analytics/health-overview-kpis')
        .flush({
          YTD: [areaState({ area: 'eng', statValue: '3 of 12', statLabel: 'groups below 50% attendance', classification: 'none', showStatus: false })],
        });
      await fixture.whenStable();

      const engTile = fixture.nativeElement.querySelector('[data-testid="health-metrics-overview-tile-eng"]');
      expect(engTile.textContent).toContain('3 of 12');
      expect(engTile.textContent).not.toContain('Awaiting data');
      const link: HTMLAnchorElement = engTile.querySelector('[data-testid="health-metrics-overview-tile-engagement-link"]');
      expect(link.getAttribute('href')).toContain('/foundation/health-metrics/engagement');
      expect(link.getAttribute('href')).toContain('#committees');
      httpMock.verify();
    });

    it('clears the previous foundation tiles while the new foundation KPI fetch is in flight', async () => {
      const foundationSignal = await render({ uid: 'proj-uid', name: 'Test Foundation', slug: 'test-foundation' }, 'a0912345678901234A');
      const httpMock = TestBed.inject(HttpTestingController);
      httpMock
        .expectOne((r) => r.url === '/api/analytics/foundation-profile-summary')
        .flush({ dataAvailable: true, projects: '14', tiers: '4 tiers', board: '12 seats', nextRenewals: '5 in the next 90 days' });
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
      // The summary signal has no startWith reset, so only the loading flag hides the previous
      // foundation's figures during the switch — assert both, or that leak regresses silently.
      expect(fixture.nativeElement.querySelector('[data-testid="health-metrics-overview-foundation-summary-skeleton"]')).not.toBeNull();
      expect(fixture.nativeElement.textContent).not.toContain('5 in the next 90 days');

      httpMock
        .expectOne((r) => r.url === '/api/analytics/foundation-profile-summary')
        .flush({ dataAvailable: true, projects: '2', tiers: '2 tiers', board: '1 seat', nextRenewals: '0 in the next 90 days' });
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
        .flush({ dataAvailable: true, projects: '14', tiers: '4 tiers', board: '12 seats', nextRenewals: '5 in the next 90 days' });
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
      selectPeriod(lastCompletedYearLabel);
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
        .flush({ dataAvailable: true, projects: '14', tiers: '4 tiers', board: '12 seats', nextRenewals: '5 in the next 90 days' });
      httpMock.expectOne((r) => r.url === '/api/analytics/health-overview-revenue').flush({ YTD: { dataAvailable: true, total: 100, streams: [] } });
      httpMock
        .expectOne((r) => r.url === '/api/analytics/health-overview-kpis')
        .flush({ YTD: [areaState({ area: 'evt', statValue: '81%', statLabel: 'of registration goal', classification: 'ok' })] });
      await fixture.whenStable();

      const lastCompletedYearLabel = String(new Date().getFullYear() - 1);
      selectPeriod(lastCompletedYearLabel);
      fixture.detectChanges();

      // Covers the `?? []` in kpiAreaStates: a period the map doesn't carry must degrade to the neutral
      // row, never keep rendering the previously selected period's figures under the new label.
      const evtTile = fixture.nativeElement.querySelector('[data-testid="health-metrics-overview-tile-evt"]');
      expect(evtTile.textContent).toContain('no data this period');
      expect(evtTile.textContent).not.toContain('81%');
      httpMock.verify();
    });

    it('keeps the tiles and both rail blocks loading, and issues no request, while no foundation is selected', async () => {
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
      // Same guard on the summary rail: without it the zero-filled default renders as a real
      // "0 projects / N/A tiers" for an ED who hasn't picked a foundation yet.
      expect(fixture.nativeElement.querySelector('[data-testid="health-metrics-overview-foundation-summary-skeleton"]')).not.toBeNull();
      httpMock.verify();
    });

    it('leaves the loading state when the foundation is cleared after one was selected', async () => {
      const foundationSignal = await render({ uid: 'proj-uid', name: 'Test Foundation', slug: 'test-foundation' }, 'a0912345678901234A');
      const httpMock = TestBed.inject(HttpTestingController);
      httpMock
        .expectOne((r) => r.url === '/api/analytics/foundation-profile-summary')
        .flush({ dataAvailable: true, projects: '14', tiers: '4 tiers', board: '12 seats', nextRenewals: '5 in the next 90 days' });
      httpMock.expectOne((r) => r.url === '/api/analytics/health-overview-revenue').flush({ YTD: { dataAvailable: true, total: 100, streams: [] } });
      httpMock
        .expectOne((r) => r.url === '/api/analytics/health-overview-kpis')
        .flush({ YTD: [areaState({ area: 'evt', statValue: '81%', statLabel: 'of registration goal', classification: 'ok' })] });
      await fixture.whenStable();

      foundationSignal.set(null);
      await fixture.whenStable();
      fixture.detectChanges();

      // The other half of the foundationSeen latch: clearing a previously selected foundation must reach
      // the terminal empty state, not wedge every tile and the rail on a skeleton that never resolves.
      const evtTile = fixture.nativeElement.querySelector('[data-testid="health-metrics-overview-tile-evt"]');
      expect(evtTile.textContent).toContain('no data this period');
      expect(evtTile.textContent).not.toContain('loading…');
      expect(fixture.nativeElement.querySelector('[data-testid="health-metrics-overview-revenue-skeleton"]')).toBeNull();
      expect(fixture.nativeElement.querySelector('[data-testid="health-metrics-overview-revenue-unavailable"]')).not.toBeNull();
      // Pins the terminal state rather than the guard (foundationSeen is already true here): the rail
      // leaves its skeleton and falls back to the default instead of keeping the cleared figures.
      expect(fixture.nativeElement.querySelector('[data-testid="health-metrics-overview-foundation-summary-skeleton"]')).toBeNull();
      expect(fixture.nativeElement.textContent).not.toContain('5 in the next 90 days');
      // Positive too: the absences above would also hold if the rail stopped rendering altogether.
      expect(fixture.nativeElement.querySelector('[data-testid="health-metrics-overview-foundation-summary-unavailable"]')).not.toBeNull();
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
        .flush({ dataAvailable: true, projects: '14', tiers: '4 tiers', board: '12 seats', nextRenewals: '5 in the next 90 days' });
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
        .flush({ dataAvailable: true, projects: '14', tiers: '4 tiers', board: '12 seats', nextRenewals: '5 in the next 90 days' });
      httpMock.expectOne((r) => r.url === '/api/analytics/health-overview-revenue').flush({ YTD: { dataAvailable: true, total: 100, streams: [] } });
      httpMock.expectOne((r) => r.url === '/api/analytics/health-overview-kpis').flush({});

      foundationSignal.set({ uid: 'other-uid', name: 'Other Foundation', slug: 'other-foundation' });
      fixture.detectChanges();

      httpMock
        .expectOne((r) => r.url === '/api/analytics/foundation-profile-summary' && r.params.get('foundationSlug') === 'other-foundation')
        .flush({ dataAvailable: true, projects: '2', tiers: '2 tiers', board: '1 seat', nextRenewals: '0 in the next 90 days' });
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
        .flush({ dataAvailable: true, projects: '14', tiers: '4 tiers', board: '12 seats', nextRenewals: '5 in the next 90 days' });
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
      selectPeriod(lastCompletedYearLabel);
      fixture.detectChanges();

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
      selectPeriod(lastCompletedYearLabel);
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('[data-testid="health-metrics-overview-revenue-unavailable"]')).not.toBeNull();
      httpMock.verify();
    });
  });
});
