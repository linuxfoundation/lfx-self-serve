// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ProjectContextService } from '@services/project-context.service';
import { describe, expect, it } from 'vitest';

import { HealthMetricsOverviewComponent } from './health-metrics-overview.component';

import type { HealthMetricsAreaState, HealthMetricsFinding, ProjectContext } from '@lfx-one/shared/interfaces';

describe('HealthMetricsOverviewComponent', () => {
  let fixture: ComponentFixture<HealthMetricsOverviewComponent>;

  async function render(foundation: ProjectContext | null, foundationSfid: string | null): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [HealthMetricsOverviewComponent],
      providers: [
        {
          provide: ProjectContextService,
          useValue: { selectedFoundation: signal(foundation), selectedFoundationSfid: signal(foundationSfid) },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(HealthMetricsOverviewComponent);
    fixture.detectChanges();
  }

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
      '[data-testid="health-metrics-overview-findings-group-act"] [data-testid^="health-metrics-overview-finding-"]'
    );
    const ranks = Array.from<Element>(rows).map((el) => Number(el.getAttribute('data-testid')?.split('-').pop()));
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

  it('omits a tile for an area with no area-state row', async () => {
    await render(null, null);
    fixture.componentRef.setInput(
      'areaStates',
      (['eng', 'evt', 'mem', 'non', 'code'] as const).map((area) => areaState({ area }))
    );
    fixture.detectChanges();

    const tileStrip = fixture.nativeElement.querySelector('[data-testid="health-metrics-overview-tile-strip"]');
    expect(tileStrip.children.length).toBe(5);
    expect(fixture.nativeElement.querySelector('[data-testid="health-metrics-overview-tile-trn"]')).toBeNull();
  });
});
