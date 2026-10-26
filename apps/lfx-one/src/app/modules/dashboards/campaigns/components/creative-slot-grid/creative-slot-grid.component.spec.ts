// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { CreativeAssetPlan } from '@lfx-one/shared/interfaces';
import { CampaignService } from '@services/campaign.service';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CreativeSlotGridComponent } from './creative-slot-grid.component';

const EMPTY_PLAN: CreativeAssetPlan = { platforms: [], assignments: [], gaps: [], unclassified: [], unused: [] };

/** A Google plan with one covered slot, one half-filled slot and one slot holding nothing. */
const PLAN: CreativeAssetPlan = {
  platforms: ['google-ads'],
  assignments: [
    {
      slotKey: 'google-ads/performance-max/marketing_image',
      platform: 'google-ads',
      channel: 'performance-max',
      slot: 'marketing_image',
      label: 'Marketing image',
      requirement: '1200x628 or wider, at least 1 image',
      assetIds: ['a-1'],
      minCount: 1,
      maxCount: 20,
    },
    {
      slotKey: 'google-ads/performance-max/logo',
      platform: 'google-ads',
      channel: 'performance-max',
      slot: 'logo',
      label: 'Logo',
      requirement: '1:1 square, at least 2 images',
      assetIds: ['a-2'],
      minCount: 2,
      maxCount: 5,
    },
  ],
  gaps: [
    {
      platform: 'google-ads',
      channel: 'performance-max',
      slotKey: 'google-ads/performance-max/logo',
      label: 'Logo',
      need: 1,
      reason: 'One more square logo is required.',
    },
    {
      platform: 'google-ads',
      channel: 'performance-max',
      slotKey: 'google-ads/performance-max/portrait_image',
      label: 'Portrait image',
      need: 1,
      reason: 'No stored image is 4:5.',
    },
  ],
  unclassified: ['a-9'],
  unused: [],
};

describe('CreativeSlotGridComponent', () => {
  let fixture: ComponentFixture<CreativeSlotGridComponent>;
  let getCreativeAssetPlan: ReturnType<typeof vi.fn>;

  // The default fixture is built in `beforeEach`, so a test that wants a different plan has to
  // tear the module down before configuring a second one.
  const build = async (plan: unknown = PLAN): Promise<void> => {
    TestBed.resetTestingModule();
    // `HttpErrorResponse` extends `HttpResponseBase`, NOT `Error` — an `instanceof Error` check
    // here would hand the component an error object as though it were a plan.
    const fails = plan instanceof HttpErrorResponse || plan instanceof Error;
    getCreativeAssetPlan = vi.fn(() => (fails ? throwError(() => plan) : of(plan)));
    await TestBed.configureTestingModule({
      imports: [CreativeSlotGridComponent],
      providers: [{ provide: CampaignService, useValue: { getCreativeAssetPlan } }],
    }).compileComponents();
    fixture = TestBed.createComponent(CreativeSlotGridComponent);
  };

  const render = (inputs: Record<string, unknown>): void => {
    for (const [name, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(name, value);
    }
    fixture.detectChanges();
  };

  const q = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  const text = (testId: string): string => q(testId)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

  beforeEach(async () => {
    await build();
  });

  // Each of the three unaddressable requests is its own row: a grid that read on two of them and
  // not the third would send campaign-service a request it is guaranteed to refuse.
  it.each([
    ['no project', { projectSlug: '', briefId: 'b-1', platforms: ['google-ads'] }],
    ['no saved brief', { projectSlug: 'tlf', briefId: '', platforms: ['google-ads'] }],
    ['no platform picked', { projectSlug: 'tlf', briefId: 'b-1', platforms: [] }],
  ])('stays idle and reads nothing with %s', (_label, inputs) => {
    render(inputs);
    expect(getCreativeAssetPlan).not.toHaveBeenCalled();
    expect(q('creative-slot-grid-idle')).not.toBeNull();
    expect(q('creative-slot-grid-complete')).toBeNull();
  });

  it('sends the picked platforms with the read', () => {
    render({ projectSlug: 'tlf', briefId: 'b-1', platforms: ['google-ads', 'reddit-ads'] });
    expect(getCreativeAssetPlan).toHaveBeenCalledWith('tlf', 'b-1', ['google-ads', 'reddit-ads']);
  });

  it('folds a gap into its assignment instead of rendering the slot twice', () => {
    render({ projectSlug: 'tlf', briefId: 'b-1', platforms: ['google-ads'] });
    const logoRows = fixture.nativeElement.querySelectorAll('[data-testid="creative-slot-row-google-ads/performance-max/logo"]');
    expect(logoRows.length).toBe(1);
    expect(text('creative-slot-row-google-ads/performance-max/logo')).toContain('Partly covered');
    expect(text('creative-slot-row-google-ads/performance-max/logo')).toContain('1 of 2 needed');
  });

  it('reports a slot with no assignment as missing', () => {
    render({ projectSlug: 'tlf', briefId: 'b-1', platforms: ['google-ads'] });
    const row = text('creative-slot-row-google-ads/performance-max/portrait_image');
    expect(row).toContain('Missing');
    expect(row).toContain('0 of 1 needed');
    expect(row).toContain('No stored image is 4:5.');
  });

  it('reports a slot with no gap as covered', () => {
    render({ projectSlug: 'tlf', briefId: 'b-1', platforms: ['google-ads'] });
    expect(text('creative-slot-row-google-ads/performance-max/marketing_image')).toContain('Covered');
  });

  it('counts only the open rows', () => {
    render({ projectSlug: 'tlf', briefId: 'b-1', platforms: ['google-ads'] });
    expect(text('creative-slot-grid-open-count')).toContain('2 slots still need an image');
    expect(q('creative-slot-grid-complete')).toBeNull();
  });

  // The honesty rule: campaign-service drops a platform it publishes no slot rules for rather than
  // refusing it, so an empty plan must never render as a library that is ready to launch.
  it('names a picked platform the plan came back without', () => {
    render({ projectSlug: 'tlf', briefId: 'b-1', platforms: ['google-ads', 'reddit-ads'] });
    expect(text('creative-slot-grid-unplanned')).toContain('Reddit Ads');
  });

  it('does not call an all-unplanned selection ready', async () => {
    await build(EMPTY_PLAN);
    render({ projectSlug: 'tlf', briefId: 'b-1', platforms: ['reddit-ads'] });
    expect(text('creative-slot-grid-unplanned')).toContain('Reddit Ads');
    expect(q('creative-slot-grid-empty')).not.toBeNull();
    expect(q('creative-slot-grid-complete')).toBeNull();
  });

  it('calls a fully covered library complete', async () => {
    await build({ ...PLAN, gaps: [] });
    render({ projectSlug: 'tlf', briefId: 'b-1', platforms: ['google-ads'] });
    expect(q('creative-slot-grid-complete')).not.toBeNull();
    expect(q('creative-slot-grid-open-count')).toBeNull();
  });

  // `unclassified` means the dimensions were never recorded, not that the image is the wrong shape.
  it('reports unclassified assets as having no recorded dimensions', () => {
    render({ projectSlug: 'tlf', briefId: 'b-1', platforms: ['google-ads'] });
    expect(text('creative-slot-grid-unclassified')).toContain('no recorded dimensions');
  });

  // Surplus is only surplus once nothing is missing — an unused image while a slot is still short
  // may well be the image that slot is waiting to be classified into.
  it('withholds the surplus line while a slot is still short', async () => {
    await build({ ...PLAN, unused: ['a-7'] });
    render({ projectSlug: 'tlf', briefId: 'b-1', platforms: ['google-ads'] });
    expect(q('creative-slot-grid-unused')).toBeNull();
  });

  it('shows the surplus line once nothing is missing', async () => {
    await build({ ...PLAN, gaps: [], unused: ['a-7'] });
    render({ projectSlug: 'tlf', briefId: 'b-1', platforms: ['google-ads'] });
    expect(text('creative-slot-grid-unused')).toContain('spare');
  });

  it('shows the service reason when the read is refused', async () => {
    await build(new HttpErrorResponse({ status: 400, error: { message: 'brief_id is required.' } }));
    render({ projectSlug: 'tlf', briefId: 'b-1', platforms: ['google-ads'] });
    expect(text('creative-slot-grid-error')).toContain('brief_id is required.');
    expect(q('creative-slot-grid-complete')).toBeNull();
  });

  // `extractErrorMessage` discards a 5xx body on purpose — it is the envelope's own log line or an
  // upstream Go string, neither written for a reader — so the component's fallback has to be one
  // an operator can act on rather than a placeholder.
  it('falls back to its own wording when the service fails', async () => {
    await build(new HttpErrorResponse({ status: 503, error: { message: 'dial tcp: connection refused' } }));
    render({ projectSlug: 'tlf', briefId: 'b-1', platforms: ['google-ads'] });
    expect(text('creative-slot-grid-error')).toBe('Failed to load image slot coverage');
  });

  // A requirement spanning several slots carries NO `slot_key` upstream — Google's reciprocal
  // landscape-or-square pair belongs to neither member alone. It keeps a row of its own, keyed on
  // its label, and states no count because there is no single slot to count in.
  it('gives a gap that names no slot its own row with no count', async () => {
    await build({
      ...PLAN,
      assignments: [],
      gaps: [
        { platform: 'google-ads', channel: 'performance-max', label: 'Landscape or square', need: 1, reason: 'Either shape satisfies this.' },
        { platform: 'google-ads', channel: 'performance-max', label: 'Portrait or square', need: 1, reason: 'Either shape satisfies this.' },
      ],
    });
    render({ projectSlug: 'tlf', briefId: 'b-1', platforms: ['google-ads'] });

    const rows = fixture.nativeElement.querySelectorAll('[data-testid^="creative-slot-row-"]');
    expect(rows.length).toBe(2);
    const row = text('creative-slot-row-google-ads/performance-max/Landscape or square');
    expect(row).toContain('Missing');
    expect(row).toContain('Either shape satisfies this.');
    expect(row).not.toContain('needed');
  });

  // `@for (row of group.rows; track row.key)` raises NG0955 on a repeated key, so two gaps that
  // name the same slot must collapse to one row rather than being emitted twice.
  it('renders one row when two gaps name the same slot', async () => {
    await build({
      ...PLAN,
      assignments: [],
      gaps: [PLAN.gaps[1], { ...PLAN.gaps[1], need: 2, reason: 'A second gap for the same slot.' }],
    });
    render({ projectSlug: 'tlf', briefId: 'b-1', platforms: ['google-ads'] });

    expect(fixture.nativeElement.querySelectorAll('[data-testid="creative-slot-row-google-ads/performance-max/portrait_image"]').length).toBe(1);
  });

  // The read is asynchronous and its OUTCOME is the point of the panel, so the answer is announced,
  // not just the wait.
  it('announces the outcome in a live region', () => {
    render({ projectSlug: 'tlf', briefId: 'b-1', platforms: ['google-ads'] });
    const live = q('creative-slot-grid-live');
    expect(live?.getAttribute('aria-live')).toBe('polite');
    expect(text('creative-slot-grid-live')).toBe('2 image slots still need an image.');
  });

  // An empty plan is named as "nothing to report", never as coverage: a plan with no gaps is also
  // exactly how a launch-ready library reads.
  it('does not announce an unplanned selection as covered', async () => {
    await build(EMPTY_PLAN);
    render({ projectSlug: 'tlf', briefId: 'b-1', platforms: ['reddit-ads'] });
    expect(text('creative-slot-grid-live')).toBe('No image slots to report for the platforms you picked.');
  });

  it('re-reads when Refresh is pressed', () => {
    render({ projectSlug: 'tlf', briefId: 'b-1', platforms: ['google-ads'] });
    expect(getCreativeAssetPlan).toHaveBeenCalledTimes(1);

    (q('creative-slot-grid-refresh') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(getCreativeAssetPlan).toHaveBeenCalledTimes(2);
  });

  it('re-reads when the host bumps the reload token', () => {
    render({ projectSlug: 'tlf', briefId: 'b-1', platforms: ['google-ads'] });
    expect(getCreativeAssetPlan).toHaveBeenCalledTimes(1);
    render({ reloadToken: 1 });
    expect(getCreativeAssetPlan).toHaveBeenCalledTimes(2);
  });

  // Reordering the picker is not a new question, and a parent that re-emits the same platforms in
  // a fresh array is not either.
  it('does not re-read for an equivalent platform list', () => {
    render({ projectSlug: 'tlf', briefId: 'b-1', platforms: ['google-ads', 'reddit-ads'] });
    expect(getCreativeAssetPlan).toHaveBeenCalledTimes(1);
    render({ platforms: ['reddit-ads', 'google-ads'] });
    expect(getCreativeAssetPlan).toHaveBeenCalledTimes(1);
  });
});
