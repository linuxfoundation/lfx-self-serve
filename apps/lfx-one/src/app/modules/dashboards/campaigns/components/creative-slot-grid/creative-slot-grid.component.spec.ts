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
      slotKey: 'google-ads/PERFORMANCE_MAX/MARKETING_IMAGE',
      platform: 'google-ads',
      channel: 'PERFORMANCE_MAX',
      slot: 'MARKETING_IMAGE',
      label: 'Performance Max marketing image',
      requirement: '1200x628 or wider, at least 1 image',
      assetIds: ['a-1'],
      minCount: 1,
      maxCount: 20,
    },
    {
      slotKey: 'google-ads/PERFORMANCE_MAX/LOGO',
      platform: 'google-ads',
      channel: 'PERFORMANCE_MAX',
      slot: 'LOGO',
      label: 'Performance Max logo',
      requirement: '1:1 square, at least 2 images',
      assetIds: ['a-2'],
      minCount: 2,
      maxCount: 5,
    },
  ],
  gaps: [
    {
      platform: 'google-ads',
      channel: 'PERFORMANCE_MAX',
      slotKey: 'google-ads/PERFORMANCE_MAX/LOGO',
      label: 'Performance Max logo',
      need: 1,
      reason: 'One more square logo is required.',
    },
    {
      platform: 'google-ads',
      channel: 'PERFORMANCE_MAX',
      slotKey: 'google-ads/PERFORMANCE_MAX/PORTRAIT_MARKETING_IMAGE',
      label: 'Performance Max portrait marketing image',
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
    const logoRows = fixture.nativeElement.querySelectorAll('[data-testid="creative-slot-row-google-ads/PERFORMANCE_MAX/LOGO"]');
    expect(logoRows.length).toBe(1);
    expect(text('creative-slot-row-google-ads/PERFORMANCE_MAX/LOGO')).toContain('Partly covered');
    expect(text('creative-slot-row-google-ads/PERFORMANCE_MAX/LOGO')).toContain('1 of 2 needed');
  });

  it('reports a slot with no assignment as missing', () => {
    render({ projectSlug: 'tlf', briefId: 'b-1', platforms: ['google-ads'] });
    const row = text('creative-slot-row-google-ads/PERFORMANCE_MAX/PORTRAIT_MARKETING_IMAGE');
    expect(row).toContain('Missing');
    expect(row).toContain('0 of 1 needed');
    expect(row).toContain('No stored image is 4:5.');
  });

  it('reports a slot with no gap as covered', () => {
    render({ projectSlug: 'tlf', briefId: 'b-1', platforms: ['google-ads'] });
    expect(text('creative-slot-row-google-ads/PERFORMANCE_MAX/MARKETING_IMAGE')).toContain('Covered');
  });

  it('counts only the open rows', () => {
    render({ projectSlug: 'tlf', briefId: 'b-1', platforms: ['google-ads'] });
    expect(text('creative-slot-grid-open-count')).toContain('2 slots still need an image');
    expect(q('creative-slot-grid-complete')).toBeNull();
  });

  // The channel arrives as Google's own enum spelling — campaign-service documents the field as
  // carrying `PERFORMANCE_MAX`, `DEMAND_GEN` and `DISPLAY` — which is a wire value, not copy for an
  // operator. Rendering it raw would shout a constant in the heading.
  it('reads the channel as a name, not as its wire spelling', () => {
    render({ projectSlug: 'tlf', briefId: 'b-1', platforms: ['google-ads'] });
    expect(text('creative-slot-group-google-ads/PERFORMANCE_MAX')).toContain('Google Ads · Performance Max');
    expect(text('creative-slot-group-google-ads/PERFORMANCE_MAX')).not.toContain('PERFORMANCE_MAX');
  });

  // `track row.key` raises NG0955 on a repeated key. Upstream states one assignment per slot, but
  // nothing between here and the wire enforces it, so the claim is guarded on both loops.
  it('renders one row for a slot upstream assigned twice', async () => {
    await build({ ...PLAN, assignments: [PLAN.assignments[0], { ...PLAN.assignments[0], assetIds: ['a-99'] }] });
    render({ projectSlug: 'tlf', briefId: 'b-1', platforms: ['google-ads'] });
    expect(fixture.nativeElement.querySelectorAll('[data-testid="creative-slot-row-google-ads/PERFORMANCE_MAX/MARKETING_IMAGE"]').length).toBe(1);
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

  // An empty plan is where `unused` is most likely to be FULL — nothing was placed, so nothing was
  // used — and "spare" against a selection nothing is known about is the reassuring reading.
  it('calls nothing spare when there are no slots to be spare of', async () => {
    await build({ ...EMPTY_PLAN, unused: ['a-7'] });
    render({ projectSlug: 'tlf', briefId: 'b-1', platforms: ['reddit-ads'] });
    expect(q('creative-slot-grid-empty')).not.toBeNull();
    expect(q('creative-slot-grid-unused')).toBeNull();
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

  // `extractErrorMessage` discards EVERY 5xx body whose code is status-derived, which is what the
  // BFF labels this route's failures with — `getCreativeAssetPlan` throws `BAD_GATEWAY`, as its
  // four siblings in the same service do. So its `clientMessage` is unreadable by policy and the
  // component's own fallback is what an operator actually sees; it has to be wording they can act
  // on rather than a placeholder. (Below 500 the body IS shown — the 400 case above pins that.)
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
        { platform: 'google-ads', channel: 'PERFORMANCE_MAX', label: 'Landscape or square', need: 1, reason: 'Either shape satisfies this.' },
        { platform: 'google-ads', channel: 'PERFORMANCE_MAX', label: 'Portrait or square', need: 1, reason: 'Either shape satisfies this.' },
      ],
    });
    render({ projectSlug: 'tlf', briefId: 'b-1', platforms: ['google-ads'] });

    const rows = fixture.nativeElement.querySelectorAll('[data-testid^="creative-slot-row-"]');
    expect(rows.length).toBe(2);
    const row = text('creative-slot-row-rule:google-ads/PERFORMANCE_MAX/Landscape or square');
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

    expect(fixture.nativeElement.querySelectorAll('[data-testid="creative-slot-row-google-ads/PERFORMANCE_MAX/PORTRAIT_MARKETING_IMAGE"]').length).toBe(1);
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

  // The visible pair says this in two elements — amber banner above, green banner below — but the
  // region is `aria-atomic` on one sentence, so an unqualified "covered" is all a listener gets.
  it('announces the unplanned platforms alongside full coverage', async () => {
    await build({ ...PLAN, gaps: [] });
    render({ projectSlug: 'tlf', briefId: 'b-1', platforms: ['google-ads', 'reddit-ads'] });
    expect(q('creative-slot-grid-complete')).not.toBeNull();
    expect(text('creative-slot-grid-live')).toBe('Every image slot below is covered, but no image slot rules are published yet for Reddit Ads.');
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

  /** "Use suggested images" (#4825): the grid hands the plan to its host, which decides what to apply. */
  describe('suggested images', () => {
    const ready = { projectSlug: 'tlf', briefId: 'b-1', platforms: ['google-ads'] };
    const TARGETS = ['google-ads/PERFORMANCE_MAX/MARKETING_IMAGE', 'google-ads/PERFORMANCE_MAX/LOGO', 'google-ads/PERFORMANCE_MAX/LANDSCAPE_LOGO'];

    it('offers no button while the host can fill no slot', () => {
      render(ready);
      expect(q('creative-slot-grid-apply')).toBeNull();
    });

    /** Suggestions only for slots the host cannot fill — another channel, another platform — would make a button that fills nothing. */
    it('offers no button when every suggestion is for a slot the host cannot fill', () => {
      render({ ...ready, suggestionTargets: ['google-ads/DISPLAY/logoImages'] });
      expect(q('creative-slot-grid-apply')).toBeNull();
    });

    it('offers no button for a plan that suggests no image', async () => {
      await build({ ...PLAN, assignments: PLAN.assignments.map((a) => ({ ...a, assetIds: [] })) });
      render({ ...ready, suggestionTargets: TARGETS });
      expect(q('creative-slot-grid-apply')).toBeNull();
    });

    it('hands over only the assignments that name an image for a slot the host can fill', async () => {
      await build({
        ...PLAN,
        assignments: [
          ...PLAN.assignments,
          { ...PLAN.assignments[0], slotKey: 'google-ads/PERFORMANCE_MAX/LANDSCAPE_LOGO', slot: 'LANDSCAPE_LOGO', assetIds: [] },
          { ...PLAN.assignments[0], slotKey: 'google-ads/DISPLAY/logoImages', channel: 'DISPLAY', slot: 'logoImages', assetIds: ['a-3'] },
        ],
      });
      render({ ...ready, suggestionTargets: TARGETS });
      const emitted: unknown[] = [];
      fixture.componentInstance.applySuggested.subscribe((assignments) => emitted.push(assignments));

      q('creative-slot-grid-apply')?.click();

      expect(emitted).toEqual([PLAN.assignments]);
    });

    /** The region is filled a tick after the render that empties it, so every apply is a change a reader announces. */
    const tick = async (): Promise<void> => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      fixture.detectChanges();
    };

    it("shows the host's result and announces it in a region that was mounted empty", async () => {
      render({ ...ready, suggestionTargets: TARGETS });
      expect(q('creative-slot-grid-apply-live')?.textContent?.trim()).toBe('');
      expect(q('creative-slot-grid-apply-result')).toBeNull();

      render({ applyResult: 'Filled 2 empty image slots with suggested images.', applySeq: 1 });
      await tick();

      expect(text('creative-slot-grid-apply-result')).toBe('Filled 2 empty image slots with suggested images.');
      expect(text('creative-slot-grid-apply-live')).toBe('Filled 2 empty image slots with suggested images.');
      expect(q('creative-slot-grid-apply-result')?.getAttribute('role')).toBeNull();
    });

    /** A polite region speaks only on change, so a second apply with the same sentence must empty it first. */
    it('announces a second apply that ends in the same sentence', async () => {
      const sentence = 'Filled 1 empty image slot with suggested images.';
      render({ ...ready, suggestionTargets: TARGETS, applyResult: sentence, applySeq: 1 });
      await tick();
      expect(text('creative-slot-grid-apply-live')).toBe(sentence);

      render({ applySeq: 2 });
      expect(text('creative-slot-grid-apply-live')).toBe('');
      // The visible line does not blink while the region is refilled.
      expect(text('creative-slot-grid-apply-result')).toBe(sentence);

      await tick();
      expect(text('creative-slot-grid-apply-live')).toBe(sentence);
    });
  });

  /** The plan reads only the library; a slot the form already fills is covered for this campaign (#4833). */
  describe('slots filled in the form', () => {
    const ready = { projectSlug: 'tlf', briefId: 'b-1', platforms: ['google-ads'] };
    const PORTRAIT = 'google-ads/PERFORMANCE_MAX/PORTRAIT_MARKETING_IMAGE';
    const LOGO = 'google-ads/PERFORMANCE_MAX/LOGO';

    it('reads a missing slot the form fills as filled in the form, and no longer counts it open', () => {
      render(ready);
      expect(text('creative-slot-grid-open-count')).toContain('2 slots still need an image');

      render({ formFilled: { [PORTRAIT]: 1 } });

      const row = text(`creative-slot-row-${PORTRAIT}`);
      expect(row).toContain('Filled in the form');
      expect(row).toContain('1 in the form');
      expect(row).not.toContain('No stored image is 4:5.');
      expect(text('creative-slot-grid-open-count')).toContain('1 slot still needs an image');
    });

    it('keeps a slot short while the form holds fewer images than the slot requires', () => {
      render({ ...ready, formFilled: { [LOGO]: 1 } });
      expect(text(`creative-slot-row-${LOGO}`)).toContain('Partly covered');

      render({ formFilled: { [LOGO]: 2 } });
      expect(text(`creative-slot-row-${LOGO}`)).toContain('Filled in the form');
    });

    it('reads every open slot as covered once the form fills them all', () => {
      render({ ...ready, formFilled: { [PORTRAIT]: 1, [LOGO]: 2 } });
      expect(q('creative-slot-grid-complete')).not.toBeNull();
    });

    /** A rule spanning several slots names none of them, so the form cannot be matched to it. */
    it('leaves a cross-slot rule row on its library reading', async () => {
      await build({
        ...PLAN,
        gaps: [
          ...PLAN.gaps,
          { platform: 'google-ads', channel: 'DISPLAY', label: 'Display marketing image, landscape or square', need: 1, reason: 'None stored.' },
        ],
      });
      render({ ...ready, formFilled: { 'google-ads/DISPLAY/marketingImages': 3 } });
      expect(text('creative-slot-row-rule:google-ads/DISPLAY/Display marketing image, landscape or square')).toContain('Missing');
    });
  });
});
