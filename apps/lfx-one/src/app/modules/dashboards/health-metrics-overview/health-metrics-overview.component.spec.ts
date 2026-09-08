// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ProjectContextService } from '@services/project-context.service';
import { describe, expect, it } from 'vitest';

import { HealthMetricsOverviewComponent } from './health-metrics-overview.component';

import type { ProjectContext } from '@lfx-one/shared/interfaces';

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
      'health-metrics-overview-findings-group-Needs action',
      'health-metrics-overview-findings-group-Needs attention',
      'health-metrics-overview-findings-group-Opportunities',
      'health-metrics-overview-findings-group-Going well',
      'health-metrics-overview-findings-group-Awaiting data',
    ]);
  });

  it('sorts findings within a group by sortRank', async () => {
    await render(null, null);

    const rows = fixture.nativeElement.querySelectorAll(
      '[data-testid="health-metrics-overview-findings-group-Needs action"] [data-testid^="health-metrics-overview-finding-"]'
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
});
