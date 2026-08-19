// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { META_OBJECTIVE_LABELS } from '@lfx-one/shared/constants';
import type { CampaignBriefOutput, CampaignBriefPersistenceState, CampaignImplementationDraft } from '@lfx-one/shared/interfaces';
import { CampaignService } from '@services/campaign.service';
import { ProjectContextService } from '@services/project-context.service';
import { MessageService } from 'primeng/api';
import { of, Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ImplementationTabComponent } from './implementation-tab.component';

/**
 * The submit gate, which is the only place the brief-save race is observable.
 *
 * The parent sets `briefId: null` for the duration of a save. With the creation cutover on, the
 * create needs that id — and `createCampaigns` refuses an empty one TERMINALLY, with no
 * fall-through to the legacy path. So a user who submits during that window used to be told
 * "brief has not been saved yet" about a brief that was being saved as they clicked.
 */
describe('ImplementationTabComponent submit gate', () => {
  let fixture: ComponentFixture<ImplementationTabComponent>;

  /** `canSubmit` is protected; read it the way the sibling campaign specs do. */
  function canSubmit(): boolean {
    return (fixture.componentInstance as unknown as { canSubmit(): boolean }).canSubmit();
  }

  /**
   * Fill everything `canSubmit` requires so persistence state is the only remaining variable.
   *
   * Google is selected, so the whole `campaignForm` must be valid — including the `headlines` and
   * `descriptions` FormArrays, whose first control is `Validators.required` and starts empty.
   */
  function makeOtherwiseValid(): void {
    const c = fixture.componentInstance as unknown as {
      selectedPlatforms: { set(v: string[]): void };
      campaignForm: {
        controls: Record<string, { setValue(v: unknown): void }>;
        get(name: string): { controls: { setValue(v: unknown): void }[] } | null;
      };
    };
    c.selectedPlatforms.set(['google-ads']);
    c.campaignForm.controls['eventName'].setValue('KubeCon EU 2026');
    c.campaignForm.controls['registrationUrl'].setValue('https://events.example.com/kubecon-eu-2026');
    c.campaignForm.controls['startDate'].setValue('2026-09-01');
    c.campaignForm.controls['endDate'].setValue('2026-09-30');
    c.campaignForm.controls['includeSearch'].setValue(true);
    c.campaignForm.controls['includeDemandGen'].setValue(false);
    c.campaignForm.get('headlines')?.controls.forEach((ctrl) => ctrl.setValue('Attend KubeCon'));
    c.campaignForm.get('descriptions')?.controls.forEach((ctrl) => ctrl.setValue('Join us in September'));
    fixture.detectChanges();
  }

  function setPersistence(state: CampaignBriefPersistenceState): void {
    fixture.componentRef.setInput('briefPersistence', state);
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ImplementationTabComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        ProjectContextService,
        { provide: MessageService, useValue: { add: vi.fn() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ImplementationTabComponent);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('blocks submit while a brief save is in flight', async () => {
    makeOtherwiseValid();
    expect(canSubmit()).toBe(true);

    setPersistence({ status: 'saving', briefId: null, message: null, approved: false });

    expect(canSubmit()).toBe(false);
  });

  it('re-enables submit once the save lands', async () => {
    makeOtherwiseValid();
    setPersistence({ status: 'saving', briefId: null, message: null, approved: false });
    expect(canSubmit()).toBe(false);

    setPersistence({ status: 'saved', briefId: 'brief-1', message: null, approved: true });

    expect(canSubmit()).toBe(true);
  });

  /**
   * A conflict outcome carries the STORED row's `briefId`, which by definition is not the brief on
   * screen — the save was refused precisely because the two disagree. Creating from it would
   * launch paid campaigns off someone else's version while the user reads their own unsaved copy.
   * The id being present is what makes it dangerous, so a null-id guard would not catch it.
   */
  it('blocks submit when a save conflicted, even though it carries a brief id', async () => {
    makeOtherwiseValid();

    setPersistence({ status: 'error', briefId: 'brief-stored-1', message: 'This brief changed elsewhere.', approved: false });

    expect(canSubmit()).toBe(false);
  });

  /**
   * The other half of `error`, and the reason the guard keys on the brief id rather than the
   * status. A save that simply FAILED carries no id, and its own banner tells the user "You can
   * continue setting up the campaign" — so disabling Create here would contradict the message
   * they are reading. With the cutover dark the legacy create needs no brief id at all.
   */
  it('does not block submit when a save failed without leaving a brief id', async () => {
    makeOtherwiseValid();

    setPersistence({
      status: 'error',
      briefId: null,
      message: 'This brief could not be saved — it will be lost if you reload. You can continue setting up the campaign.',
      approved: false,
    });

    expect(canSubmit()).toBe(true);
  });

  /**
   * The FIRST save of a session, which the status alone cannot express.
   *
   * `CampaignsComponent` leaves `briefPersistence` at `off` while that save is in flight — the
   * persistence flag lives on the server and is unknown until the response lands, so showing a
   * spinner would put a banner in front of every user in every environment where the cutover is
   * dark. The parent also switches to Implementation before the save starts, so a fast click was
   * reaching a create with `briefId: ''` and the terminal "brief has not been saved yet" refusal.
   */
  it('blocks submit during the first save, when the status still reads off', async () => {
    makeOtherwiseValid();
    setPersistence({ status: 'off', briefId: null, message: null, approved: false });
    expect(canSubmit()).toBe(true);

    fixture.componentRef.setInput('briefSaveInFlight', true);
    fixture.detectChanges();

    expect(canSubmit()).toBe(false);
  });

  /**
   * A durable but unapproved brief. `saved` is honest — the write landed — but campaign-service
   * refuses a create from it (`brief.go:439`, 400 "brief must be approved before creating
   * campaigns"), so leaving Create enabled invited the user to discover that the hard way.
   */
  it('blocks submit when the brief saved but was not approved', async () => {
    makeOtherwiseValid();

    setPersistence({
      status: 'saved',
      briefId: 'brief-1',
      message: 'This brief was saved but not approved, so campaigns cannot be created from it yet.',
      approved: false,
    });

    expect(canSubmit()).toBe(false);
  });

  /**
   * A RESTORED brief arrives as `off` with its own id, and Planning deliberately allows restoring
   * an unapproved one. campaign-service still refuses to create from it, so the id — not the
   * status — is what separates a restored brief from the cutover-dark case below.
   */
  it('blocks submit for a restored brief that was never approved', async () => {
    makeOtherwiseValid();

    setPersistence({ status: 'off', briefId: 'brief-restored-1', message: null, approved: false });

    expect(canSubmit()).toBe(false);
  });

  it('allows submit for a restored brief that IS approved', async () => {
    makeOtherwiseValid();

    setPersistence({ status: 'off', briefId: 'brief-restored-1', message: null, approved: true });

    expect(canSubmit()).toBe(true);
  });

  it('does not block submit when persistence is off', async () => {
    // The cutover-dark case. `briefId` is null here too, so a guard written as "block on a null
    // brief id" would disable the button permanently — for a path that needs no brief id at all.
    makeOtherwiseValid();

    setPersistence({ status: 'off', briefId: null, message: null, approved: false });

    expect(canSubmit()).toBe(true);
  });
});

/**
 * The Meta geo chips (LFXV2-3227).
 *
 * These render in the same pill styling as LinkedIn's editable chips but used to carry no remove
 * button and no way to add one — a control that LOOKS interactive and is not. Every test here
 * drives the real DOM (a click on the rendered button, a `change` on the rendered input) rather
 * than calling the handlers, because a handler that works while its binding is missing is exactly
 * the defect being fixed.
 */
describe('ImplementationTabComponent Meta geo targets', () => {
  let fixture: ComponentFixture<ImplementationTabComponent>;

  function metaGeoTargets(): string[] {
    return (fixture.componentInstance as unknown as { metaGeoTargets(): string[] }).metaGeoTargets();
  }

  async function setMetaGeoTargets(values: string[]): Promise<void> {
    (fixture.componentInstance as unknown as { metaGeoTargets: { set(v: string[]): void } }).metaGeoTargets.set(values);
    await fixture.whenStable();
  }

  /** Meta's section only renders when the platform is selected. */
  async function selectMeta(): Promise<void> {
    (fixture.componentInstance as unknown as { selectedPlatforms: { set(v: string[]): void } }).selectedPlatforms.set(['meta-ads']);
    await fixture.whenStable();
  }

  function query(testId: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  }

  /**
   * Read the geo add input, asserting it rendered first.
   *
   * The bare `query(...) as HTMLInputElement` this replaces turned a missing element into a
   * silent `null.value = …` TypeError, which reads as an unrelated crash rather than "the DOM
   * had not flushed". Failing on the expectation names the real cause.
   */
  function geoAddInput(): HTMLInputElement {
    const input = query('implementation-meta-geo-add');
    expect(input).not.toBeNull();
    return input as HTMLInputElement;
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ImplementationTabComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        ProjectContextService,
        { provide: MessageService, useValue: { add: vi.fn() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ImplementationTabComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    await selectMeta();
  });

  it('removes a geo target when its chip remove button is clicked', async () => {
    await setMetaGeoTargets(['US', 'JP', 'DE']);

    const removeJp = query('implementation-meta-geo-remove-JP');
    expect(removeJp).not.toBeNull();

    removeJp!.click();
    await fixture.whenStable();

    expect(metaGeoTargets()).toEqual(['US', 'DE']);
  });

  /** Every chip needs its own working button — a single wired chip would pass a one-chip test. */
  it('renders a remove button for every chip', async () => {
    await setMetaGeoTargets(['US', 'JP']);

    expect(query('implementation-meta-geo-remove-US')).not.toBeNull();
    expect(query('implementation-meta-geo-remove-JP')).not.toBeNull();
  });

  it('adds a geo target typed into the add input', async () => {
    await setMetaGeoTargets(['US']);

    const input = geoAddInput();
    input.value = 'JP';
    input.dispatchEvent(new Event('change'));
    await fixture.whenStable();

    expect(metaGeoTargets()).toEqual(['US', 'JP']);
  });

  /**
   * Enter must add the code. The input previously listened only for `(change)`, so a user who
   * typed a code and pressed Enter — the reflex for a chip input — saw nothing happen, and the
   * code was silently dropped if they then clicked away to a non-blurring target.
   */
  it('adds a geo target when Enter is pressed in the add input', async () => {
    await setMetaGeoTargets(['US']);

    const input = geoAddInput();
    input.value = 'JP';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await fixture.whenStable();

    expect(metaGeoTargets()).toEqual(['US', 'JP']);
  });

  /**
   * Enter clears the box, so the `change` event that fires on the subsequent blur carries an empty
   * value. Were the handler not clearing — or normalisation not deduping — the same code would land
   * twice from a single entry.
   */
  it('does not double-add when Enter is followed by a change event', async () => {
    await setMetaGeoTargets(['US']);

    const input = geoAddInput();
    input.value = 'JP';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await fixture.whenStable();
    input.dispatchEvent(new Event('change'));
    await fixture.whenStable();

    expect(metaGeoTargets()).toEqual(['US', 'JP']);
  });

  /** Normalised to match campaign-service's `validateGeoTargets`, which uppercases and trims. */
  it('uppercases and trims an entered code', async () => {
    await setMetaGeoTargets([]);

    const input = geoAddInput();
    input.value = ' jp ';
    input.dispatchEvent(new Event('change'));
    await fixture.whenStable();

    expect(metaGeoTargets()).toEqual(['JP']);
  });

  /**
   * The service de-dupes in first-seen order, so rendering `us` beside `US` would show a
   * targeting set that never reaches Meta.
   */
  it('does not add a duplicate that differs only in case', async () => {
    await setMetaGeoTargets(['US']);

    const input = geoAddInput();
    input.value = 'us';
    input.dispatchEvent(new Event('change'));
    await fixture.whenStable();

    expect(metaGeoTargets()).toEqual(['US']);
  });

  /**
   * Shape only — NOT eligibility. A malformed code cannot be a country, so rejecting it here
   * turns what would have been a failed campaign create into a no-op keystroke. Which countries
   * Meta accepts stays the service's call (it drops ineligible entries from a mixed list, and
   * refuses the create when nothing usable survives).
   */
  it.each(['1', '!!', 'x9', 'U', 'USA'])('ignores a malformed code %s', async (bad) => {
    await setMetaGeoTargets(['US']);

    const input = geoAddInput();
    input.value = bad;
    input.dispatchEvent(new Event('change'));
    await fixture.whenStable();

    expect(metaGeoTargets()).toEqual(['US']);
  });

  /**
   * `ZZ` is well-shaped but sits in the ISO user-assigned range, so no ad platform can ever target
   * it. The create path filters only regulated markets, so it used to survive to `geo_locations`
   * and be rejected by Meta at AD-SET creation — after `POST /campaigns` had already created a
   * billable resource. Refused at the chip now, where it costs nothing.
   */
  it('refuses a well-shaped but unassigned code', async () => {
    await setMetaGeoTargets([]);

    const input = geoAddInput();
    input.value = 'ZZ';
    input.dispatchEvent(new Event('change'));
    await fixture.whenStable();

    expect(metaGeoTargets()).toEqual([]);
  });

  /**
   * The counterpart, and the one that stops the guard over-broadening. ELIGIBILITY remains the
   * SERVICE's call: a regulated market like `SG` is officially assigned, so it must still be
   * addable here and filtered upstream where that list lives. Without this, a guard that rejected
   * every country would pass the test above while breaking geo targeting entirely.
   */
  it('still accepts an assigned country the service may later filter', async () => {
    await setMetaGeoTargets([]);

    const input = geoAddInput();
    input.value = 'SG';
    input.dispatchEvent(new Event('change'));
    await fixture.whenStable();

    expect(metaGeoTargets()).toEqual(['SG']);
  });

  it('ignores a blank entry', async () => {
    await setMetaGeoTargets(['US']);

    const input = geoAddInput();
    input.value = '   ';
    input.dispatchEvent(new Event('change'));
    await fixture.whenStable();

    expect(metaGeoTargets()).toEqual(['US']);
  });

  /**
   * `maxlength="2"` used to sit on this input, and it defeated half of `normalizeGeoTargets`.
   * The normaliser trims BEFORE it validates, precisely so a padded paste survives — but the
   * browser applies maxlength to the RAW keystrokes, clipping " jp " to " j" before the change
   * handler ever runs. The ISO-2 pattern then rejects it and the code is silently dropped.
   *
   * This asserts the ATTRIBUTE is absent rather than typing a padded value, deliberately: jsdom
   * does not enforce maxlength on a programmatic `.value` assignment, so a value-setting test
   * would pass with the cap still on the element and prove nothing about a real browser.
   */
  it('puts no maxlength on the add input, so padded input reaches the normaliser', async () => {
    await setMetaGeoTargets([]);

    expect(geoAddInput().hasAttribute('maxlength')).toBe(false);
  });

  it('clears the add input after a successful add', async () => {
    await setMetaGeoTargets([]);

    const input = geoAddInput();
    input.value = 'DE';
    input.dispatchEvent(new Event('change'));
    await fixture.whenStable();

    expect(input.value).toBe('');
  });

  /**
   * The block used to be wrapped in `@if (metaGeoTargets().length > 0)`, so a brief recommending
   * no geos hid the whole control — the user could neither see that Meta would fall back to the
   * country code nor change it. Rendering unconditionally is what makes the fallback visible.
   */
  it('renders the add control even when there are no geo targets', async () => {
    await setMetaGeoTargets([]);

    expect(query('implementation-meta-geo-add')).not.toBeNull();
  });

  /**
   * The seed path is the OTHER door into `metaGeoTargets`, and it used to bypass normalisation
   * entirely: `populateFromBrief` assigned `recommended_geos` raw. A stored `us` then survived as
   * a lowercase chip, so the add path's `includes` check could not see it as a duplicate of a
   * typed `US`, and BOTH reached the wire — the server uppercased without de-duping.
   */
  async function seedFromBrief(geos: string[], shape: 'structured' | 'typed'): Promise<void> {
    const brief: Record<string, any> = {
      eventDetails: { name: 'KubeCon EU 2026', slug: 'kubecon-eu-2026', countryCode: 'US', registrationUrl: 'https://events.example.com/k' },
      totalBudget: 500,
      keywords: [],
      hsUtm: '',
      driveFolderUrl: '',
    };
    if (shape === 'structured') {
      brief['structuredCopy'] = { meta_ads: { variants: [], recommended_geos: geos } };
    } else {
      brief['metaCopy'] = { variants: [], recommendedGeos: geos };
    }
    (fixture.componentInstance as unknown as { populateFromBrief(b: unknown): void }).populateFromBrief(brief);
    await fixture.whenStable();
  }

  it('normalises geo codes seeded from a structured brief', async () => {
    await seedFromBrief(['us', ' jp '], 'structured');

    expect(metaGeoTargets()).toEqual(['US', 'JP']);
  });

  it('de-dupes case-variant geo codes seeded from a structured brief', async () => {
    await seedFromBrief(['us', 'US', 'JP'], 'structured');

    expect(metaGeoTargets()).toEqual(['US', 'JP']);
  });

  it('normalises and de-dupes geo codes seeded from a typed brief', async () => {
    await seedFromBrief(['de', 'DE', ' fr '], 'typed');

    expect(metaGeoTargets()).toEqual(['DE', 'FR']);
  });

  /** The defect as reported: a stored lowercase code plus a typed uppercase one made two chips. */
  it('treats a typed code as a duplicate of a lowercase code seeded from the brief', async () => {
    await seedFromBrief(['us'], 'structured');
    await selectMeta();

    const input = geoAddInput();
    input.value = 'US';
    input.dispatchEvent(new Event('change'));
    await fixture.whenStable();

    expect(metaGeoTargets()).toEqual(['US']);
  });

  it('drops a mis-shaped geo code seeded from the brief', async () => {
    await seedFromBrief(['us', 'USA', '1', ''], 'structured');

    expect(metaGeoTargets()).toEqual(['US']);
  });

  it('can add a geo target back after removing the last one', async () => {
    await setMetaGeoTargets(['US']);

    query('implementation-meta-geo-remove-US')!.click();
    await fixture.whenStable();
    expect(metaGeoTargets()).toEqual([]);

    const input = geoAddInput();
    input.value = 'FR';
    input.dispatchEvent(new Event('change'));
    await fixture.whenStable();

    expect(metaGeoTargets()).toEqual(['FR']);
  });
});

/**
 * Meta objective, placements and pixel id (LFXV2-3228).
 *
 * The shared interface has accepted all three for some time and `buildMetaConfig` spreads them
 * straight through, so the only thing that was missing was the form ever putting them on the
 * wire. These tests therefore assert on the REQUEST OBJECT rather than on the signals: a
 * collected-but-unsent field is precisely the defect being fixed, and a signal assertion would
 * pass while it persisted.
 *
 * The guards mirror campaign-service's `buildPlacementTargeting` and `buildPromotedObject`, both
 * of which run before any mutating call. Client-side validation therefore changes no outcome —
 * it changes only whether the user hears about it before or after a round trip.
 */
describe('ImplementationTabComponent Meta objective, placements and pixel', () => {
  let fixture: ComponentFixture<ImplementationTabComponent>;
  let createCampaign: ReturnType<typeof vi.fn>;

  function component(): Record<string, any> {
    return fixture.componentInstance as unknown as Record<string, any>;
  }

  function canSubmit(): boolean {
    return component()['canSubmit']();
  }

  function query(testId: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  }

  /** Read a rendered element, asserting presence before the cast. */
  function require<T extends HTMLElement>(testId: string): T {
    const el = query(testId);
    expect(el).not.toBeNull();
    return el as T;
  }

  /** Fill everything Meta's half of `canSubmit` needs, so one field at a time is the variable. */
  async function makeMetaValid(): Promise<void> {
    const c = component();
    c['selectedPlatforms'].set(['meta-ads']);
    c['campaignForm'].controls['eventName'].setValue('KubeCon EU 2026');
    c['campaignForm'].controls['registrationUrl'].setValue('https://events.example.com/kubecon-eu-2026');
    c['campaignForm'].controls['startDate'].setValue('2026-09-01');
    c['campaignForm'].controls['endDate'].setValue('2026-09-30');
    c['metaVariants'].set([{ primaryText: 'Join us', headline: 'KubeCon EU', description: 'September' }]);
    await fixture.whenStable();
  }

  /** Submit and return the `metaConfig` the service was actually called with. */
  async function submittedMetaConfig(): Promise<Record<string, any>> {
    component()['submit']();
    await fixture.whenStable();
    expect(createCampaign).toHaveBeenCalled();
    return createCampaign.mock.calls[0][0].metaConfig;
  }

  async function selectObjective(value: string): Promise<void> {
    const select = require<HTMLSelectElement>('implementation-meta-objective');
    select.value = value;
    select.dispatchEvent(new Event('change'));
    await fixture.whenStable();
  }

  async function togglePlacement(key: string, enabled: boolean): Promise<void> {
    const box = require<HTMLInputElement>(`implementation-meta-placement-${key}`);
    box.checked = enabled;
    box.dispatchEvent(new Event('change'));
    await fixture.whenStable();
  }

  async function typePixelId(value: string): Promise<void> {
    const input = require<HTMLInputElement>('implementation-meta-pixel-id');
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
  }

  beforeEach(async () => {
    createCampaign = vi.fn().mockReturnValue(of({ result: { campaigns: [], errors: [] } }));

    await TestBed.configureTestingModule({
      imports: [ImplementationTabComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        ProjectContextService,
        { provide: MessageService, useValue: { add: vi.fn() } },
        // `getLinkedInAccounts` is stubbed because `ngOnInit` calls it unconditionally, even with
        // only Meta selected; without it the component throws before any Meta assertion runs.
        { provide: CampaignService, useValue: { createCampaign, getLinkedInAccounts: () => of([]) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ImplementationTabComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    await makeMetaValid();
  });

  // === Objective ===

  /**
   * Asserted as a LITERAL list. The previous version compared against
   * `Object.keys(META_OBJECTIVE_LABELS)`, which agreed with whatever that map contained and so
   * could never have caught an objective appearing or disappearing from the picker.
   */
  it('renders exactly the selectable objectives, in order', () => {
    const select = require<HTMLSelectElement>('implementation-meta-objective');
    const rendered = Array.from(select.options).map((o) => o.value);

    expect(rendered).toEqual(['awareness', 'traffic', 'engagement', 'conversions']);
  });

  /**
   * `leads` dispatches as a website-traffic campaign (see `META_OBJECTIVE_PARAMS.leads`), so
   * offering it would label a traffic campaign "Leads". Hidden until LFXV2-2665 builds
   * instant-form support.
   */
  it('does not offer leads', () => {
    const select = require<HTMLSelectElement>('implementation-meta-objective');
    const rendered = Array.from(select.options).map((o) => o.value);

    expect(rendered).not.toContain('leads');
  });

  /** The label stays defined even though the option is gone — the server names campaigns from it. */
  it('keeps a label for the hidden leads objective', () => {
    expect(META_OBJECTIVE_LABELS['leads']).toBe('Leads');
  });

  /**
   * A draft persisted before `leads` was hidden restores an objective with no matching
   * `<option>`. Driven through the REAL draft input rather than by setting the signal directly:
   * a signal-only test leaves `applyDraft` unexercised, and a coercion added there — mapping the
   * unrenderable value onto the first option — silently discards the user's stored objective
   * while passing. That mutation survived until this test went through the draft path.
   *
   * `leads` must survive to the wire, where `META_OBJECTIVE_PARAMS` dispatches it as the
   * website-traffic campaign it has always been.
   */
  it('still submits leads when a persisted draft carries it', async () => {
    const restored = TestBed.createComponent(ImplementationTabComponent);
    restored.componentRef.setInput('draft', {
      eventSlug: 'kubecon-eu-2026',
      metaObjective: 'leads',
      headlines: [''],
      descriptions: [''],
    });
    restored.componentRef.setInput('briefData', {
      eventDetails: { name: 'KubeCon EU 2026', slug: 'kubecon-eu-2026', registrationUrl: 'https://events.example.com/k' },
      selectedPlatforms: ['meta-ads'],
    } as unknown as CampaignBriefOutput);
    restored.detectChanges();
    await restored.whenStable();

    const c = restored.componentInstance as unknown as Record<string, any>;

    expect(c['metaObjective']()).toBe('leads');
  });

  /**
   * The other half of the same restore: an objective the picker CAN render must still round-trip,
   * so the assertion above cannot be satisfied by a restore path that ignores the draft entirely.
   */
  it('restores a selectable objective from a persisted draft', async () => {
    const restored = TestBed.createComponent(ImplementationTabComponent);
    restored.componentRef.setInput('draft', {
      eventSlug: 'kubecon-eu-2026',
      metaObjective: 'engagement',
      headlines: [''],
      descriptions: [''],
    });
    restored.componentRef.setInput('briefData', {
      eventDetails: { name: 'KubeCon EU 2026', slug: 'kubecon-eu-2026', registrationUrl: 'https://events.example.com/k' },
      selectedPlatforms: ['meta-ads'],
    } as unknown as CampaignBriefOutput);
    restored.detectChanges();
    await restored.whenStable();

    const c = restored.componentInstance as unknown as Record<string, any>;

    expect(c['metaObjective']()).toBe('engagement');
  });

  /**
   * `traffic` matches what campaign-service assumes when `objective` is absent, so switching the
   * selector on cannot change the campaign an existing user would have got.
   */
  it('sends traffic as the default objective', async () => {
    expect((await submittedMetaConfig())['objective']).toBe('traffic');
  });

  it('sends the objective the user picked', async () => {
    await selectObjective('awareness');

    expect((await submittedMetaConfig())['objective']).toBe('awareness');
  });

  // === Geo eligibility, and display/dispatch agreement ===

  /**
   * `IR` is an ASSIGNED ISO country, so the assignment check passes it — but Meta refuses to
   * target it, and on the legacy path that refusal lands at the AD SET, after `POST /campaigns`
   * has created a billable resource. Refused at the chip, where it costs nothing.
   */
  it('refuses an assigned but Meta-ineligible geo code', async () => {
    const c = component();
    c['metaGeoTargets'].set([]);
    await fixture.whenStable();

    const input = require<HTMLInputElement>('implementation-meta-geo-add');
    input.value = 'IR';
    input.dispatchEvent(new Event('change'));
    await fixture.whenStable();

    expect(c['metaGeoTargets']()).toEqual([]);
  });

  /**
   * The counterpart that stops the guard over-broadening: a guard rejecting every country would
   * pass the test above while breaking geo targeting outright.
   */
  it('still accepts an eligible geo code', async () => {
    const c = component();
    c['metaGeoTargets'].set([]);
    await fixture.whenStable();

    const input = require<HTMLInputElement>('implementation-meta-geo-add');
    input.value = 'JP';
    input.dispatchEvent(new Event('change'));
    await fixture.whenStable();

    expect(c['metaGeoTargets']()).toEqual(['JP']);
  });

  /**
   * The chip add was the ONLY door checking eligibility. The brief seed and the draft restore
   * wrote `metaGeoTargets` through `normalizeGeoTargets` alone, which settles shape and ISO
   * assignment but never asks whether Meta will target the country.
   *
   * That split is invisible unless you look at both surfaces at once. The chip list renders
   * `metaGeoTargets()` while `submit()` sends `metaEffectiveGeoTargets()`, which filters
   * ineligible codes — so a seeded `IR` DISPLAYED a chip the request silently dropped. The
   * empty-state warning could not catch it either: it is gated on `metaGeoTargets().length === 0`,
   * and the surviving chip made that false, so `canSubmit` passed on the `countryCode` fallback.
   * The operator read `IR` on screen and bought a JP-only campaign.
   *
   * The binding assertion is that DISPLAY AND DISPATCH AGREE. Asserting only that the request
   * omits `IR` would pass on the unfixed code too, because `metaEffectiveGeoTargets` already
   * filtered it — what was broken, and what this pins, is the CHIP LIST.
   */
  it('drops a Meta-ineligible geo the brief recommended, on screen as well as on the wire', async () => {
    const seeded = TestBed.createComponent(ImplementationTabComponent);
    seeded.componentRef.setInput('briefData', {
      eventDetails: { name: 'KubeCon EU 2026', slug: 'kubecon-eu-2026', registrationUrl: 'https://events.example.com/k' },
      selectedPlatforms: ['meta-ads'],
      metaCopy: { variants: [], recommendedGeos: ['IR', 'JP'] },
    } as unknown as CampaignBriefOutput);
    seeded.detectChanges();
    await seeded.whenStable();

    const c = seeded.componentInstance as unknown as Record<string, any>;

    expect(c['metaGeoTargets']()).toEqual(['JP']);
    expect(c['metaEffectiveGeoTargets']()).toEqual(['JP']);
  });

  /** The same unguarded door, reached through a restored draft rather than a fresh brief. */
  it('drops a Meta-ineligible geo carried by a restored draft', async () => {
    const restored = TestBed.createComponent(ImplementationTabComponent);
    restored.componentRef.setInput('draft', {
      eventSlug: 'kubecon-eu-2026',
      metaGeoTargets: ['CU', 'JP'],
      headlines: [''],
      descriptions: [''],
    });
    restored.componentRef.setInput('briefData', {
      eventDetails: { name: 'KubeCon EU 2026', slug: 'kubecon-eu-2026', registrationUrl: 'https://events.example.com/k' },
      selectedPlatforms: ['meta-ads'],
    } as unknown as CampaignBriefOutput);
    restored.detectChanges();
    await restored.whenStable();

    const c = restored.componentInstance as unknown as Record<string, any>;

    expect(c['metaGeoTargets']()).toEqual(['JP']);
    expect(c['metaEffectiveGeoTargets']()).toEqual(['JP']);
  });

  /**
   * The counterpart that stops the shared filter over-broadening: routing all three doors through
   * one helper must not start rejecting countries Meta accepts, and must still de-dupe.
   */
  it('keeps eligible geos the brief recommended', async () => {
    const seeded = TestBed.createComponent(ImplementationTabComponent);
    seeded.componentRef.setInput('briefData', {
      eventDetails: { name: 'KubeCon EU 2026', slug: 'kubecon-eu-2026', registrationUrl: 'https://events.example.com/k' },
      selectedPlatforms: ['meta-ads'],
      metaCopy: { variants: [], recommendedGeos: ['jp', 'de', 'JP'] },
    } as unknown as CampaignBriefOutput);
    seeded.detectChanges();
    await seeded.whenStable();

    const c = seeded.componentInstance as unknown as Record<string, any>;

    expect(c['metaGeoTargets']()).toEqual(['JP', 'DE']);
  });

  /**
   * The display/dispatch divergence. `countryCode` carries no validator, so it can be blank with
   * no chips left; the preview then read "defaults to " while `submit()` sent `['']`, which the
   * server resolved to `US` — a paid US campaign the operator was never shown.
   *
   * The binding assertion is that submission is BLOCKED, not that the message changed: a fix that
   * only corrected the text would still let the request go out.
   */
  it('blocks a meta create when no usable geo target survives', async () => {
    const c = component();
    c['metaGeoTargets'].set([]);
    c['campaignForm'].controls['countryCode'].setValue('');
    await fixture.whenStable();

    expect(c['metaEffectiveGeoTargets']()).toEqual([]);
    expect(canSubmit()).toBe(false);
    expect(query('implementation-meta-geo-none')).not.toBeNull();
  });

  /** Display and dispatch must name the SAME country when the fallback does apply. */
  it('sends exactly the geo the empty-state line displays', async () => {
    const c = component();
    c['metaGeoTargets'].set([]);
    c['campaignForm'].controls['countryCode'].setValue('de');
    await fixture.whenStable();

    expect(c['metaEffectiveGeoTargets']()).toEqual(['DE']);
    expect((await submittedMetaConfig())['geoTargets']).toEqual(['DE']);
  });

  // === Draft survival across a tab switch ===

  /**
   * The parent renders this component inside an `@switch`/`@case`, so visiting Insights DESTROYS
   * it. These four Meta values live in component signals that `campaignForm.valueChanges` never
   * sees, so before this fix a user who chose Conversions, entered a pixel, turned off a
   * placement or edited a geo chip and glanced at another tab came back to traffic and the
   * defaults — silently changing the paid request they were about to submit.
   *
   * The binding assertion is what the REMOUNTED component would SUBMIT, not merely that the draft
   * object has the fields on it. A draft that carried the values but was never restored — or was
   * restored into signals `submit()` does not read — would pass a shape assertion and still lose
   * the user's edit.
   */
  it('carries the user Meta edits through a destroy/remount and into the request', async () => {
    // Edit all four surfaces, capturing the draft the component emits as it goes.
    let draft: Record<string, any> | null = null;
    component()['draftChange'].subscribe((d: Record<string, any>) => (draft = d));

    await selectObjective('conversions');
    await typePixelId('998877');
    await togglePlacement('reels', true);
    component()['addMetaGeoTarget']('jp');
    component()['metaBudgetUsd'].set(1234);
    component()['metaLifetimeBudget'].set(true);
    component()['emitDraft']();
    await fixture.whenStable();

    expect(draft).not.toBeNull();
    const draftSlug = (draft as unknown as Record<string, any>)['eventSlug'];

    // Destroy and remount — exactly what the parent's @switch does on a tab visit. The draft is
    // restored through the real path: the `briefData` effect seeds from the brief and THEN applies
    // the draft over it, which is the ordering that makes a carried-over edit win.
    const restored = TestBed.createComponent(ImplementationTabComponent);
    restored.componentRef.setInput('draft', draft);
    restored.componentRef.setInput('briefData', {
      eventDetails: { name: 'KubeCon EU 2026', slug: draftSlug, registrationUrl: 'https://events.example.com/kubecon-eu-2026' },
      selectedPlatforms: ['meta-ads'],
    } as unknown as CampaignBriefOutput);
    restored.detectChanges();
    await restored.whenStable();

    const c = restored.componentInstance as unknown as Record<string, any>;
    c['campaignForm'].controls['startDate'].setValue('2026-09-01');
    c['campaignForm'].controls['endDate'].setValue('2026-09-30');
    c['metaVariants'].set([{ primaryText: 'Join us', headline: 'KubeCon EU', description: 'September' }]);
    await restored.whenStable();

    createCampaign.mockClear();
    c['submit']();
    await restored.whenStable();

    expect(createCampaign).toHaveBeenCalled();
    const metaConfig = createCampaign.mock.calls[0][0].metaConfig;
    expect(metaConfig['objective']).toBe('conversions');
    expect(metaConfig['pixelId']).toBe('998877');
    expect(metaConfig['placements']).toEqual({ reels: true });
    expect(metaConfig['geoTargets']).toContain('JP');
    // The budget pair is the one whose loss is measured in money: a silent revert puts the
    // campaign back to $500/day, a spend decision the operator did not make.
    expect(metaConfig['budgetUsd']).toBe(1234);
    expect(metaConfig['lifetimeBudget']).toBe(true);
  });

  /**
   * A draft persisted BEFORE these fields shipped carries none of them. Absence must mean "keep
   * what the brief seeded", never "the user chose the defaults" — otherwise an old draft silently
   * downgrades a Conversions campaign to traffic on the next tab switch. `undefined` is what
   * preserves that distinction; a present-but-empty `metaPixelId` is a real cleared value.
   */
  it('leaves Meta settings seeded when an older draft omits them', async () => {
    await selectObjective('conversions');
    await typePixelId('554433');
    const slug = component()['campaignForm'].controls['eventSlug'].value;

    const legacyDraft = {
      eventName: 'KubeCon EU 2026',
      countryCode: 'US',
      registrationUrl: 'https://events.example.com/kubecon-eu-2026',
      headlines: [],
      descriptions: [],
      budgetUsd: 500,
      searchBudgetPct: 70,
      startDate: '2026-09-01',
      endDate: '2026-09-30',
      includeSearch: true,
      includeDemandGen: false,
      eventSlug: slug,
    };

    const restored = TestBed.createComponent(ImplementationTabComponent);
    restored.componentRef.setInput('draft', legacyDraft);
    restored.componentRef.setInput('briefData', {
      eventDetails: { name: 'KubeCon EU 2026', slug, registrationUrl: 'https://events.example.com/kubecon-eu-2026' },
      selectedPlatforms: ['meta-ads'],
    } as unknown as CampaignBriefOutput);
    restored.detectChanges();
    await restored.whenStable();

    const c = restored.componentInstance as unknown as Record<string, any>;
    // Stand in for values the brief seeded on this mount. The legacy draft names none of the Meta
    // fields, so the restore must leave every one of them exactly as seeded.
    c['metaObjective'].set('conversions');
    c['metaPixelId'].set('554433');
    c['applyDraft']();
    await restored.whenStable();

    expect(c['metaObjective']()).toBe('conversions');
    expect(c['metaPixelId']()).toBe('554433');
  });

  // === Placements ===

  /**
   * Only the entries that differ from `META_DEFAULT_PLACEMENTS` are sent. Upstream merges the
   * override map field-by-field over those same defaults, so an untouched form must put no
   * placement keys on the wire at all.
   */
  it('sends no placement overrides when the defaults are untouched', async () => {
    expect((await submittedMetaConfig())['placements']).toEqual({});
  });

  it('sends only the placements that differ from the defaults', async () => {
    await togglePlacement('reels', true);

    expect((await submittedMetaConfig())['placements']).toEqual({ reels: true });
  });

  it('sends a disabled default placement as an explicit false', async () => {
    await togglePlacement('facebookFeed', false);

    expect((await submittedMetaConfig())['placements']).toEqual({ facebookFeed: false });
  });

  /**
   * Rule 3. `buildPlacementTargeting` refuses a request whose `publisher_platforms` list comes out
   * empty, and it does so at the ad-set call — after the campaign, a paid resource, exists.
   */
  /**
   * The override map is built by DROPPING keys equal to `META_DEFAULT_PLACEMENTS`, so toggling a
   * default-on placement off and back on must re-collapse to `{}`. The other placement specs only
   * move one direction, which a `!==`→`!=` slip or a lost shallow copy would still satisfy while
   * shipping a redundant `facebookFeed: true` override.
   */
  it('re-collapses to no overrides when a default placement is toggled off then on', async () => {
    await togglePlacement('facebookFeed', false);
    await togglePlacement('facebookFeed', true);

    expect((await submittedMetaConfig())['placements']).toEqual({});
  });

  it('blocks submit when every selectable placement is off', async () => {
    expect(canSubmit()).toBe(true);

    await togglePlacement('facebookFeed', false);
    await togglePlacement('instagramFeed', false);

    expect(canSubmit()).toBe(false);
    expect(query('implementation-meta-placement-error')).not.toBeNull();
  });

  /**
   * The checkbox group is a `fieldset`/`legend`, not a `div`/`span`. Without it a screen-reader
   * user hears each checkbox as an unrelated control, can switch the last placement off, and
   * reaches a disabled Create button with nothing announcing why — the group's error is not
   * associated with any control they visited.
   */
  it('groups the placements in a fieldset whose legend names the group', async () => {
    const legend: HTMLLegendElement | null = fixture.nativeElement.querySelector('fieldset > legend');

    expect(legend).not.toBeNull();
    expect(legend!.textContent?.trim()).toBe('Placements');
  });

  it('marks the placement fieldset invalid and points it at the error when none is enabled', async () => {
    const fieldset = (): HTMLFieldSetElement => {
      const el = fixture.nativeElement.querySelector('fieldset');
      expect(el).not.toBeNull();
      return el as HTMLFieldSetElement;
    };

    expect(fieldset().getAttribute('aria-invalid')).toBeNull();
    expect(fieldset().getAttribute('aria-describedby')).toBeNull();

    await togglePlacement('facebookFeed', false);
    await togglePlacement('instagramFeed', false);

    expect(fieldset().getAttribute('aria-invalid')).toBe('true');
    const describedBy = fieldset().getAttribute('aria-describedby');
    expect(describedBy).toBe('meta-placement-error');
    // The id must actually resolve, or the association announces nothing.
    const error: HTMLElement | null = fixture.nativeElement.querySelector(`#${describedBy}`);
    expect(error).not.toBeNull();
    // aria-describedby alone is only read when focus reaches the group; role="alert" is what
    // announces the error at the moment the last placement is switched off.
    expect(error!.getAttribute('role')).toBe('alert');
  });

  it('re-enables submit when a placement is turned back on', async () => {
    await togglePlacement('facebookFeed', false);
    await togglePlacement('instagramFeed', false);
    expect(canSubmit()).toBe(false);

    await togglePlacement('reels', true);

    expect(canSubmit()).toBe(true);
  });

  /**
   * Rule 2. Meta removed Messenger Inbox in November 2025 and campaign-service rejects the
   * placement outright. The toggle renders so its absence is not read as a missing feature, but
   * it must be inert.
   */
  it('renders the messengerInbox placement disabled', () => {
    const box = require<HTMLInputElement>('implementation-meta-placement-messengerInbox');

    expect(box.disabled).toBe(true);
    expect(box.checked).toBe(false);
  });

  /**
   * The disabled attribute is a presentation guarantee, not a state one. The handler refuses the
   * key independently, so even a direct call — a future template change binding a live control —
   * cannot put `messengerInbox: true` on the wire.
   */
  it('refuses a messengerInbox toggle even when the handler is called directly', async () => {
    component()['onMetaPlacementChange']('messengerInbox', { target: { checked: true } } as unknown as Event);
    await fixture.whenStable();

    expect(component()['metaPlacements']()['messengerInbox']).toBe(false);
    expect((await submittedMetaConfig())['placements']).toEqual({});
  });

  /** Enabling every selectable placement must still never introduce the retired key. */
  it('never sends messengerInbox even with every other placement enabled', async () => {
    await togglePlacement('stories', true);
    await togglePlacement('reels', true);
    await togglePlacement('audienceNetwork', true);

    const placements = (await submittedMetaConfig())['placements'];

    expect(placements).not.toHaveProperty('messengerInbox');
    expect(placements).toEqual({ stories: true, reels: true, audienceNetwork: true });
  });

  // === Pixel id ===

  /**
   * Only `conversions` promotes a pixel object. Under the other objectives campaign-service
   * promotes a page id or nothing, so collecting a pixel would be collecting a field it ignores.
   */
  it('hides the pixel field unless the objective is conversions', async () => {
    expect(query('implementation-meta-pixel-id')).toBeNull();

    await selectObjective('conversions');

    expect(query('implementation-meta-pixel-id')).not.toBeNull();
  });

  it('omits pixelId from the payload under a non-conversions objective', async () => {
    await selectObjective('engagement');

    expect(await submittedMetaConfig()).not.toHaveProperty('pixelId');
  });

  it('blocks submit when conversions is selected with no pixel id', async () => {
    expect(canSubmit()).toBe(true);

    await selectObjective('conversions');

    expect(canSubmit()).toBe(false);
    expect(query('implementation-meta-pixel-error')).not.toBeNull();
  });

  /**
   * The check `buildPromotedObject` makes that an empty-only test would miss. "PIX9" is
   * non-empty, so a truthiness guard passes it; Meta Pixel ids are numeric and upstream rejects
   * it on `numericIDRE`.
   */
  it('blocks submit for a non-empty but malformed pixel id', async () => {
    await selectObjective('conversions');

    await typePixelId('PIX9');

    expect(canSubmit()).toBe(false);
  });

  /** Upstream trims before both checks, so a whitespace-only id must read as empty here too. */
  it('blocks submit for a whitespace-only pixel id', async () => {
    await selectObjective('conversions');

    await typePixelId('   ');

    expect(canSubmit()).toBe(false);
  });

  it('allows submit and sends the pixel id once it is numeric', async () => {
    await selectObjective('conversions');
    await typePixelId('123456789012345');

    expect(canSubmit()).toBe(true);
    // The objective is asserted alongside the id so the pairing is pinned positively: a pixel id
    // must ship WITH `conversions`, not merely be absent under everything else.
    const config = await submittedMetaConfig();
    expect(config['pixelId']).toBe('123456789012345');
    expect(config['objective']).toBe('conversions');
  });

  it('trims the pixel id it sends', async () => {
    await selectObjective('conversions');
    await typePixelId('  123456789012345  ');

    expect(canSubmit()).toBe(true);
    const config = await submittedMetaConfig();
    expect(config['pixelId']).toBe('123456789012345');
    expect(config['objective']).toBe('conversions');
  });

  /**
   * A stale id left in the box after switching away from `conversions` must neither block submit
   * nor reach the wire — the field no longer applies, so it is neither validated nor sent.
   */
  it('drops a stale pixel id after switching away from conversions', async () => {
    await selectObjective('conversions');
    await typePixelId('PIX9');
    expect(canSubmit()).toBe(false);

    await selectObjective('traffic');

    expect(canSubmit()).toBe(true);
    expect(await submittedMetaConfig()).not.toHaveProperty('pixelId');
  });
});

/**
 * What the create request actually CARRIES for the email channel.
 *
 * The template picker's `selectedEmailTemplateId` was write-only before this: set on click, read
 * only for `aria-pressed` and row styling, and never placed on a request. These assert the value
 * reaches `hubspotConfig.sourceEmailId`, which campaign-service requires with no default.
 */
describe('ImplementationTabComponent hubspotConfig wiring', () => {
  let fixture: ComponentFixture<ImplementationTabComponent>;
  let posted: Record<string, unknown> | null;

  function makeOtherwiseValid(): void {
    const c = fixture.componentInstance as unknown as {
      selectedPlatforms: { set(v: string[]): void };
      campaignForm: {
        controls: Record<string, { setValue(v: unknown): void }>;
        get(name: string): { controls: { setValue(v: unknown): void }[] } | null;
      };
    };
    c.selectedPlatforms.set(['google-ads']);
    c.campaignForm.controls['eventName'].setValue('KubeCon EU 2026');
    c.campaignForm.controls['registrationUrl'].setValue('https://events.example.com/kubecon-eu-2026');
    c.campaignForm.controls['startDate'].setValue('2026-09-01');
    c.campaignForm.controls['endDate'].setValue('2026-09-30');
    c.campaignForm.controls['includeSearch'].setValue(true);
    c.campaignForm.controls['includeDemandGen'].setValue(false);
    c.campaignForm.get('headlines')?.controls.forEach((ctrl) => ctrl.setValue('Attend KubeCon'));
    c.campaignForm.get('descriptions')?.controls.forEach((ctrl) => ctrl.setValue('Join us in September'));
    fixture.detectChanges();
  }

  /** Drive the real `submit()` and capture the body handed to the service. */
  function submitAndCapture(): void {
    (fixture.componentInstance as unknown as { submit(): void }).submit();
  }

  beforeEach(async () => {
    posted = null;
    await TestBed.configureTestingModule({
      imports: [ImplementationTabComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        ProjectContextService,
        { provide: MessageService, useValue: { add: vi.fn() } },
        {
          // Stubbed at the service boundary rather than the HTTP one: the assertion is about the
          // REQUEST BODY the component builds, and a stub keeps the create from being dispatched
          // anywhere. Nothing here can reach HubSpot or spend money.
          provide: CampaignService,
          useValue: {
            createCampaign: (request: Record<string, unknown>) => {
              posted = request;
              return of({ jobId: '' });
            },
            // `ngOnInit` resolves the LinkedIn ad-account list on mount. Stubbed empty because
            // these tests select google-ads only, so the list is never read.
            getLinkedInAccounts: () => of([]),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ImplementationTabComponent);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('carries the chosen template id as hubspotConfig.sourceEmailId', () => {
    makeOtherwiseValid();
    fixture.componentRef.setInput('sourceEmailId', 'email-123');
    fixture.detectChanges();

    submitAndCapture();

    expect(posted?.['hubspotConfig']).toEqual({ sourceEmailId: 'email-123' });
  });

  it('omits hubspotConfig entirely when no template is chosen', () => {
    // The paid-only path, which is every create today. An empty-but-present config would be a
    // configured-looking email channel on a campaign that has none.
    makeOtherwiseValid();

    submitAndCapture();

    expect(posted).not.toHaveProperty('hubspotConfig');
  });

  it('treats a whitespace-only template id as no selection, matching the server', () => {
    // `buildHubSpotConfig` trims and returns null (UNCONFIGURED) for a blank id. Sending
    // `{ sourceEmailId: '   ' }` would claim a template was picked and be refused upstream.
    makeOtherwiseValid();
    fixture.componentRef.setInput('sourceEmailId', '   ');
    fixture.detectChanges();

    submitAndCapture();

    expect(posted).not.toHaveProperty('hubspotConfig');
  });

  it('trims a padded template id rather than sending the padding', () => {
    makeOtherwiseValid();
    fixture.componentRef.setInput('sourceEmailId', '  email-456  ');
    fixture.detectChanges();

    submitAndCapture();

    expect(posted?.['hubspotConfig']).toEqual({ sourceEmailId: 'email-456' });
  });
});

/**
 * Reddit needs a budget floor like its siblings.
 *
 * Reddit's client rejects a non-positive budget at dispatch ("invalid budget: must be a positive
 * number"), and creation is ASYNC — so without a local guard that surfaces as a dead job the
 * operator has to go and read, rather than as a blocked submit button.
 */
describe('ImplementationTabComponent reddit budget gate', () => {
  let fixture: ComponentFixture<ImplementationTabComponent>;

  function canSubmit(): boolean {
    return (fixture.componentInstance as unknown as { canSubmit(): boolean }).canSubmit();
  }

  /** The rendered geo chips, by their own text — see the note in the ordering spec. */
  function geoChipTexts(): string[] {
    const section = fixture.nativeElement.querySelector('[data-testid="implementation-reddit-section"]');
    const label = [...(section?.querySelectorAll('label') ?? [])].find((l: Element) => l.textContent?.includes('Geo Targets'));
    const block = label?.parentElement;
    return [...(block?.querySelectorAll('span') ?? [])].map((el: Element) => (el.textContent ?? '').trim());
  }

  function setup(budget: number): void {
    const c = fixture.componentInstance as unknown as {
      selectedPlatforms: { set(v: string[]): void };
      redditBudgetUsd: { set(v: number): void };
      campaignForm: { controls: Record<string, { setValue(v: unknown): void }> };
    };
    c.selectedPlatforms.set(['reddit-ads']);
    c.redditBudgetUsd.set(budget);
    c.campaignForm.controls['eventName'].setValue('KubeCon EU 2026');
    c.campaignForm.controls['registrationUrl'].setValue('https://events.example.com/kubecon');
    c.campaignForm.controls['startDate'].setValue('2026-09-01');
    c.campaignForm.controls['endDate'].setValue('2026-09-30');
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ImplementationTabComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        ProjectContextService,
        { provide: MessageService, useValue: { add: vi.fn() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ImplementationTabComponent);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('blocks submit when the reddit budget is zero', () => {
    setup(0);
    expect(canSubmit()).toBe(false);
  });

  it('renders the reddit config section when reddit is selected', () => {
    setup(500);

    // The section's EXISTENCE is the fix: showRedditSection was computed but bound to nothing,
    // so a Reddit campaign dispatched on values the operator never saw. Query the budget input
    // specifically — a section that rendered a heading and no inputs would still be unusable.
    const section = fixture.nativeElement.querySelector('[data-testid="implementation-reddit-section"]');
    const budget = fixture.nativeElement.querySelector('[data-testid="implementation-reddit-budget"]');
    expect(section).not.toBeNull();
    expect(budget).not.toBeNull();
    expect((budget as HTMLInputElement).value).toBe('500');
  });

  it('shows the country-code fallback when the brief recommends no geo targets', () => {
    setup(500);
    const c = fixture.componentInstance as unknown as { campaignForm: { controls: Record<string, { setValue(v: unknown): void }> } };
    c.campaignForm.controls['countryCode'].setValue('DE');
    fixture.detectChanges();

    // submit() falls back to [countryCode] when the brief recommends no geos, so a preview
    // reading the raw signal would render nothing for a request that targets Germany — the
    // section would hide the very targeting it exists to surface.
    const section = fixture.nativeElement.querySelector('[data-testid="implementation-reddit-section"]');
    expect(section?.textContent).toContain('DE');
  });

  it.each([
    ['above the platform cap', 2_000_000_000],
    ['not finite', Number.POSITIVE_INFINITY],
  ])('blocks submit when the reddit budget is %s', (_label, budget) => {
    setup(budget);
    // Reddit's client rejects both during dispatch. Creation is async, so without a local guard
    // these become dead jobs the operator has to go and read rather than a blocked button — the
    // same argument that justifies the floor.
    expect(canSubmit()).toBe(false);
  });

  it('blocks submit when the country code is cleared and the brief recommends no geos', () => {
    setup(500);
    const c = fixture.componentInstance as unknown as { campaignForm: { controls: Record<string, { setValue(v: unknown): void }> } };
    // countryCode carries no validator, so clearing it is reachable. submit() previously sent
    // [''] in that state — a value Reddit cannot target, and one the operator could not see
    // because the preview correctly renders nothing.
    c.campaignForm.controls['countryCode'].setValue('');
    fixture.detectChanges();

    expect(geoChipTexts()).toEqual([]);
    expect(canSubmit()).toBe(false);
  });

  it.each([
    ['lowercase', 'us'],
    ['too long', 'USA'],
    ['too short', 'U'],
  ])('blocks submit when the country code is %s', (_label, code) => {
    setup(500);
    const c = fixture.componentInstance as unknown as { campaignForm: { controls: Record<string, { setValue(v: unknown): void }> } };
    c.campaignForm.controls['countryCode'].setValue(code);
    fixture.detectChanges();
    // 'us' normalises to 'US' and is fine; the other two have no valid shape and would reach
    // dispatch as an unusable geo. Asserted per-case rather than as one blanket expectation.
    expect(canSubmit()).toBe(code === 'us');
  });

  it('prefers recommended geos even when they arrive after the country code', () => {
    setup(500);
    const c = fixture.componentInstance as unknown as {
      campaignForm: { controls: Record<string, { setValue(v: unknown): void }> };
      redditGeoTargets: { set(v: string[]): void };
    };
    // The ORDER matters: populateFromBrief patches the form first and assigns recommended geos
    // afterwards. A derivation keyed only on countryCode's valueChanges reads an empty geo list,
    // and nothing re-runs it when the real geos land — so the preview would show the fallback
    // while submit() dispatches the recommended list.
    c.campaignForm.controls['countryCode'].setValue('US');
    fixture.detectChanges();
    c.redditGeoTargets.set(['DE', 'FR']);
    fixture.detectChanges();

    // Assert on the CHIPS, not the section text: the budget label reads "(USD, lifetime)", so a
    // not-toContain('US') over the whole section can never pass — it would fail against correct
    // code and read as a real defect.
    const geos = geoChipTexts();
    expect(geos).toContain('DE');
    expect(geos).toContain('FR');
    // The fallback must be GONE, not merely joined by the recommended list.
    expect(geos).not.toContain('US');
  });

  it('falls back to the country code when the recommended geos are all unusable', () => {
    setup(500);
    const c = fixture.componentInstance as unknown as {
      campaignForm: { controls: Record<string, { setValue(v: unknown): void }> };
      redditGeoTargets: { set(v: string[]): void };
    };
    // A generated or restored brief can carry a non-empty but unusable recommendation. Choosing
    // the branch on the RAW list makes it win on length alone, filter to nothing, and block
    // submit permanently — with a perfectly valid country sitting unread in the form.
    c.campaignForm.controls['countryCode'].setValue('US');
    c.redditGeoTargets.set(['USA']);
    fixture.detectChanges();

    expect(geoChipTexts()).toEqual(['US']);
    expect(canSubmit()).toBe(true);
  });

  it('strips an r/ prefix so the preview matches what dispatches', () => {
    setup(500);
    const c = fixture.componentInstance as unknown as { redditSubreddits: { set(v: string[]): void } };
    // 'r/k8s' is a real stored value — campaign-service.service.spec.ts asserts it survives
    // restore verbatim — and dispatch strips an optional prefix. Rendered under the template's
    // fixed 'r/' it previewed as 'r/r/k8s', so the section promising to show what will be sent
    // showed something else.
    c.redditSubreddits.set(['r/k8s', 'kubernetes']);
    fixture.detectChanges();

    const chips = Array.from(fixture.nativeElement.querySelectorAll('span')).map((el) => (el as HTMLElement).textContent?.trim());
    expect(chips).toContain('r/k8s');
    expect(chips).not.toContain('r/r/k8s');
    expect(chips).toContain('r/kubernetes');
  });

  it('hides the subreddit block when every name normalises away', () => {
    setup(500);
    const c = fixture.componentInstance as unknown as { redditSubreddits: { set(v: string[]): void } };
    // A brief carrying only unusable names: the raw list is non-empty, the effective list is not.
    // Gating on the raw list renders a "Subreddits (0)" heading above an empty chip row.
    c.redditSubreddits.set(['r/', '/r/', '   ']);
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).not.toContain('Subreddits (0)');

    // And a usable name still renders, or the assertion above would pass by hiding the block
    // unconditionally.
    c.redditSubreddits.set(['kubernetes']);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Subreddits (1)');
  });

  it('allows submit once the reddit budget is positive', () => {
    setup(500);
    // The positive case must pass, or the zero case above would be satisfied by any unrelated
    // guard rather than by the budget floor it claims to bind.
    expect(canSubmit()).toBe(true);
  });
});

/**
 * A brief saved BEFORE a platform was disabled must not restore that platform.
 *
 * The Plan picker gates `disabled` at the tile, but a stored brief reaches `selectedPlatforms`
 * through `populateFromBrief`, which never consults the picker. Without a filter there, a brief
 * naming a since-disabled platform still submits that platform's config on brief-derived values
 * the user never saw — and the disabled tile means they cannot deselect it either.
 *
 * These cases use `twitter-ads` deliberately: it is disabled for a CAPABILITY reason (its
 * platform client has no account discovery), so it is the stable example. Reddit was the
 * original one and stopped being disabled the moment its Implement section landed — a test
 * keyed to a flag that flips is a test that expires.
 */
describe('ImplementationTabComponent brief restore', () => {
  let fixture: ComponentFixture<ImplementationTabComponent>;

  function selectedPlatforms(): string[] {
    return [...(fixture.componentInstance as unknown as { selectedPlatforms(): string[] }).selectedPlatforms()];
  }

  function restore(platforms: string[]): void {
    fixture.componentRef.setInput('briefData', {
      eventDetails: { name: 'KubeCon EU 2026', slug: 'kubecon-eu-2026', registrationUrl: 'https://example.com' },
      selectedPlatforms: platforms,
    } as unknown as CampaignBriefOutput);
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ImplementationTabComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        ProjectContextService,
        { provide: MessageService, useValue: { add: vi.fn() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ImplementationTabComponent);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('drops a disabled platform from a restored brief', () => {
    restore(['google-ads', 'twitter-ads']);

    expect(selectedPlatforms()).not.toContain('twitter-ads');
    // The enabled sibling must SURVIVE — a filter that dropped everything would pass a
    // not-toContain assertion on its own while silently discarding the user's real choice.
    expect(selectedPlatforms()).toContain('google-ads');
  });

  it('selects nothing for an all-disabled brief rather than substituting a default', () => {
    restore(['twitter-ads']);

    // NOT ['google-ads']. Retaining the default would open a brief for a disabled platform as a
    // GOOGLE campaign, and submit() builds its request from this signal — the user would
    // dispatch a platform they never chose. Empty leaves canSubmit() blocking, which is honest.
    expect(selectedPlatforms()).toEqual([]);
  });
});

/**
 * What the create request actually CARRIES for the email channel.
 *
 * The template picker's `selectedEmailTemplateId` was write-only before this: set on click, read
 * only for `aria-pressed` and row styling, and never placed on a request. These assert the value
 * reaches `hubspotConfig.sourceEmailId`, which campaign-service requires with no default.
 */
describe('ImplementationTabComponent linkedin round-trip across a tab switch', () => {
  /** Matches the slug on the brief below — `applyDraft` ignores a draft keyed to another event. */
  const EVENT_SLUG = 'kubecon-eu-2026';

  /** Two real URNs from the shared resolve map, so `addGeoTarget` can find them. */
  const US_GEO = { urn: 'urn:li:geo:103644278', label: 'United States' };
  const DE_GEO = { urn: 'urn:li:geo:101165590', label: 'Germany' };

  const brief = (): CampaignBriefOutput =>
    ({
      eventDetails: { name: 'KubeCon EU 2026', slug: EVENT_SLUG, countryCode: 'US', registrationUrl: 'https://example.com/kubecon' },
      totalBudget: 500,
      selectedPlatforms: ['google-ads', 'linkedin-ads'],
      structuredCopy: { google_search: { headlines: ['Attend KubeCon'], descriptions: ['Join us in September'] } },
      linkedInCopy: {
        variants: [{ headline: 'Attend KubeCon', introText: 'Join us', destinationUrl: 'https://example.com/kubecon' }],
        // The values the component would re-stamp on remount. Every assertion below edits away
        // from these so a passing test cannot be explained by the re-stamp.
        recommendedGeoTargets: [US_GEO],
        recommendedTargetingProfile: 'cloud-native',
      },
      keywords: [],
      hsUtm: null,
      driveFolderUrl: '',
    }) as unknown as CampaignBriefOutput;

  /** The three fields are form controls now; read them the way `submit()` does. */
  interface Internals {
    campaignForm: { controls: Record<string, { value: unknown; setValue(v: unknown): void }> };
    linkedInAccountId(): string;
    linkedInGeoTargets(): { urn: string; label: string }[];
    linkedInTargetingProfile(): string;
    removeGeoTarget(index: number): void;
    addGeoTarget(urn: string): void;
    setLinkedInTargetingProfile(profile: string): void;
    /**
     * The template's `(change)` handler, NOT the `setLinkedInAccount` convenience method.
     *
     * `setLinkedInAccount` has no call site in this component's template — only a test ever
     * reached it — so driving the round-trip through it would leave a regression in the real
     * handler completely green while live account selections stopped reaching the draft.
     */
    onLinkedInAccountChange(event: Event): void;
  }
  const at = (f: ComponentFixture<ImplementationTabComponent>): Internals => f.componentInstance as unknown as Internals;

  /**
   * Mount a component on the brief exactly as the parent does, capturing what it emits.
   *
   * The captured draft is the ONLY thing carried to the next mount — same as production, where
   * the parent's signal is all that survives the component's teardown.
   */
  async function mount(draft: CampaignImplementationDraft | null): Promise<{
    fixture: ComponentFixture<ImplementationTabComponent>;
    latest: () => CampaignImplementationDraft | null;
  }> {
    const f = TestBed.createComponent(ImplementationTabComponent);
    let captured: CampaignImplementationDraft | null = null;
    f.componentRef.instance.draftChange.subscribe((d: CampaignImplementationDraft) => (captured = d));
    if (draft) f.componentRef.setInput('draft', draft);
    f.componentRef.setInput('briefData', brief());
    f.detectChanges();
    await f.whenStable();
    return { fixture: f, latest: () => captured };
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ImplementationTabComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        ProjectContextService,
        { provide: MessageService, useValue: { add: vi.fn() } },
      ],
    }).compileComponents();
  });

  /**
   * A removal must survive, and proving that needs a SECOND geo on the form.
   *
   * Removing the brief's only recommendation leaves `[]`, and `[]` is also what a component with
   * no restore at all shows before its seed runs — so asserting an empty list passes whether or
   * not the restore works. (Verified, not assumed: with the `applyDraft` restore deleted, that
   * version of this test still passed while its three siblings failed.)
   *
   * Adding Germany first and then removing the US entry makes the expected value `[DE]`, which is
   * neither the brief's recommendation (`[US]`) nor the empty default. Only a working restore can
   * produce it.
   */
  it('keeps a removed geo target removed after a tab round-trip', async () => {
    const first = await mount(null);
    at(first.fixture).addGeoTarget(DE_GEO.urn);
    first.fixture.detectChanges();
    // Drop the brief's US recommendation, keeping the user's own addition.
    at(first.fixture).removeGeoTarget(0);
    first.fixture.detectChanges();
    expect(
      at(first.fixture)
        .linkedInGeoTargets()
        .map((g) => g.urn)
    ).toEqual([DE_GEO.urn]);

    const carried = first.latest();
    first.fixture.destroy();

    const second = await mount(carried);

    // NOT [US] (the re-stamped recommendation) and NOT [US, DE] (a restore that ignored the
    // removal). The removal and the addition both survived.
    expect(
      at(second.fixture)
        .linkedInGeoTargets()
        .map((g) => g.urn)
    ).toEqual([DE_GEO.urn]);
  });

  it('keeps an added geo target after a tab round-trip', async () => {
    const first = await mount(null);
    at(first.fixture).addGeoTarget(DE_GEO.urn);
    first.fixture.detectChanges();

    const carried = first.latest();
    first.fixture.destroy();

    const second = await mount(carried);

    // Both the recommendation AND the addition, in that order — asserting only that Germany is
    // present would also pass if the restore had dropped the brief's own US entry.
    expect(
      at(second.fixture)
        .linkedInGeoTargets()
        .map((g) => g.urn)
    ).toEqual([US_GEO.urn, DE_GEO.urn]);
  });

  it('keeps a switched targeting profile after a tab round-trip', async () => {
    const first = await mount(null);
    // Away from the brief's `cloud-native`, so the re-stamp cannot produce this value.
    at(first.fixture).setLinkedInTargetingProfile('mcp');
    first.fixture.detectChanges();

    const carried = first.latest();
    first.fixture.destroy();

    const second = await mount(carried);

    expect(at(second.fixture).linkedInTargetingProfile()).toBe('mcp');
  });

  /**
   * Clearing EVERY geo target must survive, and nothing else in this suite pins it.
   *
   * Two docblocks argue at length that an empty list is a deliberate user action rather than a
   * hole, and that a `draft.linkedInGeoTargets.length ? … : recommendation` fallback would be the
   * defect rather than the fix. That claim was reintroducible without a red test: every other
   * round-trip case here ends with a NON-EMPTY list, so a length-guarded restore passed all of
   * them. Verified by mutation — introducing exactly that fallback left the whole suite green.
   *
   * Deliberately does NOT assert `canSubmit()` here. This suite never resolves
   * `getLinkedInAccounts`, so the catalog stays empty and the account-membership gate holds
   * `canSubmit()` false on its own — an assertion here passed even with the geo gate deleted
   * outright, which makes it a claim about nothing. The geo gate gets its own test in the account
   * suite below, where a stubbed catalog lets it be the only failing condition.
   */
  it('keeps an emptied geo list empty after a tab round-trip', async () => {
    const first = await mount(null);
    // The brief recommends exactly one; removing it leaves the list genuinely empty.
    at(first.fixture).removeGeoTarget(0);
    first.fixture.detectChanges();
    expect(at(first.fixture).linkedInGeoTargets()).toEqual([]);

    const carried = first.latest();
    first.fixture.destroy();

    const second = await mount(carried);

    // NOT the brief's [US] recommendation, which is what a length-guarded restore would produce.
    expect(at(second.fixture).linkedInGeoTargets()).toEqual([]);
  });

  it('keeps a chosen ad account after a tab round-trip', async () => {
    const first = await mount(null);
    // Through the handler the TEMPLATE binds, so a regression in it fails this test. Calling
    // `setLinkedInAccount` instead would pass against a broken `(change)` binding, since nothing
    // in this component's template calls that method.
    at(first.fixture).onLinkedInAccountChange({ target: { value: 'urn:li:sponsoredAccount:999' } } as unknown as Event);
    first.fixture.detectChanges();

    const carried = first.latest();
    first.fixture.destroy();

    const second = await mount(carried);

    expect(at(second.fixture).linkedInAccountId()).toBe('urn:li:sponsoredAccount:999');
  });

  /**
   * The seed must still reach the form when there is nothing to restore.
   *
   * `populateFromBrief` seeds UNCONDITIONALLY and `applyDraft` runs after it, so the restore wins
   * by ordering rather than by a guard. That makes this the case which proves the seed still
   * works at all: every test above overwrites it, so a seed that silently stopped reaching the
   * form would be invisible to them. Without it a first-time user opens with an empty geo list
   * and `canSubmit` blocking the LinkedIn section permanently.
   *
   * It is also what pins the seed's EMISSION. The three controls are read through `toSignal`
   * bridges over `valueChanges`, so writing them with `{ emitEvent: false }` updates the control
   * while every reader keeps the stale initial value — this test fails on exactly that.
   */
  it('still seeds from the brief on a first visit with no draft', async () => {
    const first = await mount(null);

    expect(
      at(first.fixture)
        .linkedInGeoTargets()
        .map((g) => g.urn)
    ).toEqual([US_GEO.urn]);
    expect(at(first.fixture).linkedInTargetingProfile()).toBe('cloud-native');
  });

  /**
   * A draft keyed to a DIFFERENT event must not replay onto this brief.
   *
   * `applyDraft` compares the draft's `eventSlug` against the form's and returns early on a
   * mismatch, so event A's picks cannot overwrite event B's freshly generated recommendation —
   * the same ownership rule the `(project, event)` keys enforce elsewhere. Since the seed already
   * ran unconditionally, declining the restore leaves the brief's own values standing, which is
   * what this asserts.
   */
  it('seeds from the brief when the carried draft belongs to another event', async () => {
    const first = await mount(null);
    at(first.fixture).removeGeoTarget(0);
    first.fixture.detectChanges();

    const foreign = { ...(first.latest() as CampaignImplementationDraft), eventSlug: 'some-other-event' };
    first.fixture.destroy();

    const second = await mount(foreign);

    // The BRIEF's recommendation, not the foreign draft's empty list.
    expect(
      at(second.fixture)
        .linkedInGeoTargets()
        .map((g) => g.urn)
    ).toEqual([US_GEO.urn]);
  });
});

/**
 * The ad-account fetch versus a restored choice (LFXV2-3230).
 *
 * `ngOnInit` resolves the LinkedIn ad-account list on EVERY mount — that network call is the whole
 * reason this tab is destroyed on a tab switch rather than kept alive. Its response defaults the
 * selection to the first account, and that default has to lose to a restored draft: the response
 * lands after the constructor effect has already replayed the user's choice onto the form, so an
 * unguarded assignment would overwrite it on every single return to the tab.
 *
 * The rule is CATALOG MEMBERSHIP: a selection the returned list does not contain is replaced by
 * the first account, or cleared when the list is empty. That covers three situations with one
 * test — the first visit (`''` is never in the list), a restored choice that is still offered, and
 * a restored choice that has been revoked.
 *
 * The suites above leave `CampaignService` unstubbed, so the list resolves empty and this branch
 * is never meaningfully exercised there. These cases stub a real list, and release it through a
 * `Subject` so it lands AFTER the restore — the production ordering, and the only one in which the
 * rule does any work.
 */

describe('ImplementationTabComponent linkedin account defaulting', () => {
  const EVENT_SLUG = 'kubecon-eu-2026';
  const ACCOUNTS = [
    { accountId: 'urn:li:sponsoredAccount:111', label: 'First Account', orgId: 'urn:li:organization:1', status: 'ACTIVE' },
    { accountId: 'urn:li:sponsoredAccount:222', label: 'Second Account', orgId: 'urn:li:organization:2', status: 'ACTIVE' },
  ];

  const brief = (): CampaignBriefOutput =>
    ({
      eventDetails: { name: 'KubeCon EU 2026', slug: EVENT_SLUG, countryCode: 'US', registrationUrl: 'https://example.com/kubecon' },
      totalBudget: 500,
      selectedPlatforms: ['linkedin-ads'],
      keywords: [],
      hsUtm: null,
      driveFolderUrl: '',
    }) as unknown as CampaignBriefOutput;

  const draftWith = (accountId: string): CampaignImplementationDraft =>
    ({
      eventName: 'KubeCon EU 2026',
      countryCode: 'US',
      registrationUrl: 'https://example.com/kubecon',
      headlines: [],
      descriptions: [],
      budgetUsd: 500,
      searchBudgetPct: 70,
      startDate: '2026-09-01',
      endDate: '2026-09-30',
      includeSearch: true,
      includeDemandGen: true,
      linkedInAccountId: accountId,
      linkedInGeoTargets: [],
      linkedInTargetingProfile: 'cloud-native',
      eventSlug: EVENT_SLUG,
    }) as CampaignImplementationDraft;

  /**
   * Release the ad-account response by hand, so the test controls WHEN it lands.
   *
   * This is the whole point of the suite. A synchronous `of(ACCOUNTS)` resolves inside
   * `ngOnInit` — before the constructor effect has replayed the draft — so the default is applied
   * to an empty form and `applyDraft` overwrites it a moment later. The guard is then unreachable
   * and deleting it changes nothing. (Confirmed by mutation: with a synchronous stub, removing the
   * guard left all tests green.)
   *
   * Production is the other order: the response is an HTTP round-trip that lands well AFTER the
   * effect has restored the user's account. A `Subject` reproduces that, and it is the only
   * arrangement in which the guard does any work.
   */
  let accountsSubject: Subject<typeof ACCOUNTS>;

  /**
   * The last draft emitted to the parent, so the emission half can be asserted too.
   *
   * Read through `emitted()` rather than directly: assigning only inside the subscribe callback
   * lets TypeScript narrow the variable to `never` at the assertion site.
   */
  let lastEmitted: CampaignImplementationDraft | null = null;
  const emitted = (): CampaignImplementationDraft | null => lastEmitted;

  /** `catalog` defaults to the two-account list; pass `[]` for the unconfigured-LinkedIn case. */
  async function mount(draft: CampaignImplementationDraft | null, catalog: typeof ACCOUNTS = ACCOUNTS): Promise<ComponentFixture<ImplementationTabComponent>> {
    const f = TestBed.createComponent(ImplementationTabComponent);
    lastEmitted = null;
    f.componentRef.instance.draftChange.subscribe((d: CampaignImplementationDraft) => (lastEmitted = d));
    if (draft) f.componentRef.setInput('draft', draft);
    f.componentRef.setInput('briefData', brief());
    f.detectChanges();
    await f.whenStable();
    // The restore has already run; only now does the ad-account list arrive.
    accountsSubject.next(catalog);
    accountsSubject.complete();
    f.detectChanges();
    await f.whenStable();
    return f;
  }

  const accountId = (f: ComponentFixture<ImplementationTabComponent>): string =>
    (f.componentInstance as unknown as { linkedInAccountId(): string }).linkedInAccountId();

  beforeEach(async () => {
    accountsSubject = new Subject<typeof ACCOUNTS>();
    await TestBed.configureTestingModule({
      imports: [ImplementationTabComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        ProjectContextService,
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: CampaignService, useValue: { getLinkedInAccounts: () => accountsSubject.asObservable() } },
      ],
    }).compileComponents();
  });

  it('defaults to the first account when nothing is restored', async () => {
    const fixture = await mount(null);

    expect(accountId(fixture)).toBe(ACCOUNTS[0].accountId);
  });

  /** The guard's reason for existing: a restored choice must outlive the fetch that follows it. */
  it('keeps a restored account rather than defaulting over it', async () => {
    const fixture = await mount(draftWith(ACCOUNTS[1].accountId));

    expect(accountId(fixture)).toBe(ACCOUNTS[1].accountId);
  });

  /**
   * An EMPTY catalog is a real answer, and it must clear a restored id rather than skip.
   *
   * `loadLinkedInConfig` falls back to `accounts: []` when the LinkedIn config is absent or
   * malformed (`linkedin-ads.service.ts:39`), so a SUCCESSFUL response can carry nothing. A guard
   * that required `accounts.length > 0` skipped entirely in that case, leaving the restored id on
   * the form with no account to match it — the selector renders empty while `submit()` still
   * dispatches the stale value. Clearing is the honest outcome, and `canSubmit`'s membership gate
   * then holds the create BLOCKED rather than letting it reach LinkedIn: an empty catalog contains
   * no id, including ''. The operator sees Create disabled beside an empty account list, which is
   * the true state, instead of a create that fails somewhere they cannot see.
   */
  /**
   * The two windows `ngOnInit`'s reconciliation cannot cover.
   *
   * It only runs on a SUCCESSFUL response, so a restored id sits unverified on the form both
   * before the request returns and permanently if it fails — with `linkedInAccounts()` empty in
   * each case. Without a submit gate a create would dispatch an account nothing confirmed and the
   * selector is not showing, which is the divergence the reconciliation exists to prevent,
   * reached where it does not run.
   *
   * `canSubmit` therefore requires catalog MEMBERSHIP rather than a non-empty id.
   */
  it('blocks a linkedin create while the account catalog is still loading', async () => {
    const f = TestBed.createComponent(ImplementationTabComponent);
    f.componentRef.setInput('draft', draftWith(ACCOUNTS[1].accountId));
    f.componentRef.setInput('briefData', brief());
    f.detectChanges();
    await f.whenStable();
    // Deliberately do NOT release accountsSubject: the fetch is still in flight.

    makeLinkedInOtherwiseValid(f);

    expect((f.componentInstance as unknown as { canSubmit(): boolean }).canSubmit()).toBe(false);
  });

  it('keeps a linkedin create blocked when the account fetch fails', async () => {
    const f = TestBed.createComponent(ImplementationTabComponent);
    f.componentRef.setInput('draft', draftWith(ACCOUNTS[1].accountId));
    f.componentRef.setInput('briefData', brief());
    f.detectChanges();
    await f.whenStable();
    // A failed fetch leaves loading false with an empty catalog — the worst case, because
    // nothing further will ever arrive to correct the restored id.
    accountsSubject.error(new Error('ad-account endpoint unavailable'));
    f.detectChanges();
    await f.whenStable();

    makeLinkedInOtherwiseValid(f);

    expect((f.componentInstance as unknown as { canSubmit(): boolean }).canSubmit()).toBe(false);
  });

  /**
   * The geo gate, isolated — the only place in the suite where it can be.
   *
   * `canSubmit` blocks a LinkedIn create with no geo targets, but that gate was covered NOWHERE:
   * deleting it left all 460 tests green. The round-trip suite cannot cover it, because it never
   * resolves the account catalog and the membership gate blocks there regardless. Here the
   * catalog IS stubbed and every other LinkedIn gate is satisfied, so clearing the geo list is
   * the single failing condition.
   */
  it('blocks a linkedin create when the geo target list is empty', async () => {
    const f = await mount(draftWith(ACCOUNTS[1].accountId));
    makeLinkedInOtherwiseValid(f);
    const c = f.componentInstance as unknown as {
      canSubmit(): boolean;
      campaignForm: { controls: Record<string, { setValue(v: unknown): void }> };
    };
    // Everything satisfied, including a catalog-confirmed account.
    expect(c.canSubmit()).toBe(true);

    c.campaignForm.controls['linkedInGeoTargets'].setValue([]);
    f.detectChanges();

    expect(c.canSubmit()).toBe(false);
  });

  /**
   * The same gate reached with an ABSENT list rather than an empty one.
   *
   * `linkedInGeoTargets` is declared non-optional on `CampaignImplementationDraft`, but nothing
   * validates a draft on the way in: `applyDraft` hands `patchValue` whatever it holds and
   * `patchValue` passes `undefined` through untouched. Reading `.length` off that threw inside the
   * `canSubmit` computed, which the template reads — so instead of disabling one button it took
   * down the entire tab, re-throwing on every change-detection pass.
   *
   * The binding assertion is that it RETURNS false. Asserting merely that it does not throw would
   * pass on a guard that returned true, which is the fail-open answer — a create dispatched with
   * no geo targets at all.
   */
  it('blocks rather than crashing when the restored geo list is absent', async () => {
    const f = await mount(draftWith(ACCOUNTS[1].accountId));
    makeLinkedInOtherwiseValid(f);
    const c = f.componentInstance as unknown as {
      canSubmit(): boolean;
      campaignForm: { controls: Record<string, { setValue(v: unknown): void }> };
    };
    expect(c.canSubmit()).toBe(true);

    c.campaignForm.controls['linkedInGeoTargets'].setValue(undefined);
    f.detectChanges();

    expect(c.canSubmit()).toBe(false);
  });

  /** Satisfy every LinkedIn gate EXCEPT the account one, so that gate is the only variable. */
  function makeLinkedInOtherwiseValid(f: ComponentFixture<ImplementationTabComponent>): void {
    const c = f.componentInstance as unknown as {
      selectedPlatforms: { set(v: string[]): void };
      campaignForm: { controls: Record<string, { setValue(v: unknown): void }> };
      linkedInVariants: { set(v: unknown[]): void };
    };
    c.selectedPlatforms.set(['linkedin-ads']);
    c.campaignForm.controls['eventName'].setValue('KubeCon EU 2026');
    c.campaignForm.controls['registrationUrl'].setValue('https://example.com/kubecon');
    c.campaignForm.controls['startDate'].setValue('2026-09-01');
    c.campaignForm.controls['endDate'].setValue('2026-09-30');
    c.campaignForm.controls['linkedInGeoTargets'].setValue([{ urn: 'urn:li:geo:103644278', label: 'United States' }]);
    c.linkedInVariants.set([{ headline: 'Attend', introText: 'Join us', destinationUrl: 'https://example.com/kubecon' }]);
    f.detectChanges();
  }

  it('clears a restored account when the catalog comes back empty', async () => {
    // A SUCCESSFUL response that happens to carry no accounts, released after the restore.
    const f = await mount(draftWith(ACCOUNTS[1].accountId), []);

    expect(accountId(f)).toBe('');
    // The parent learns about it too, so a later tab switch cannot restore the stale id.
    expect(emitted()?.linkedInAccountId).toBe('');
  });

  /**
   * The CORRECTED account must also reach the parent's draft, not just the form.
   *
   * `ngOnInit` runs after the constructor effect, so this `setValue` lands outside the `seeding`
   * window and its emission is what carries the correction to the parent. Nothing else pinned
   * that, which makes `{ emitEvent: false }` an easy "optimisation" for someone to add later —
   * and it would silently strand the parent's draft on the stale id while the form and the
   * request both moved on. The next tab switch would then restore the stale id all over again.
   */
  it('emits the corrected account to the parent draft', async () => {
    await mount(draftWith('urn:li:sponsoredAccount:revoked-999'));

    expect(emitted()?.linkedInAccountId).toBe(ACCOUNTS[0].accountId);
  });

  /**
   * A restored account this catalog no longer offers must not survive — and what `submit()` SENDS
   * must match what the page DISPLAYS.
   *
   * Persisting the id (LFXV2-3230) made a stale one reachable for the first time: an account can
   * be revoked or lose permission between mounts, and the list is refetched on every mount. The
   * DIVERGENCE is the danger rather than the staleness. `selectedLinkedInAccount` resolves the
   * label and org/status line through `accounts.find(...) ?? accounts[0]`, and the `<select>`
   * cannot render an unmatched value either, so both fall back to the first account — while
   * `submit()` sends `linkedInAccountId()` verbatim. The operator reads "First Account" and spends
   * money on the revoked one.
   *
   * Asserting only that the id changed would miss the point, since the bug is precisely that two
   * surfaces disagree. This drives the real `submit()` and compares the dispatched
   * `linkedInConfig.adAccountId` against the displayed account.
   */
  it('does not dispatch to an account the page is not displaying', async () => {
    let posted: Record<string, unknown> | null = null;
    // Re-configure with a capturing stub: this is the only case here that reaches `submit()`.
    TestBed.resetTestingModule();
    accountsSubject = new Subject<typeof ACCOUNTS>();
    await TestBed.configureTestingModule({
      imports: [ImplementationTabComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        ProjectContextService,
        { provide: MessageService, useValue: { add: vi.fn() } },
        {
          // Stubbed at the service boundary, matching the hubspotConfig suite above: the assertion
          // is about the request body, and the stub keeps the create from dispatching anywhere.
          provide: CampaignService,
          useValue: {
            getLinkedInAccounts: () => accountsSubject.asObservable(),
            createCampaign: (request: Record<string, unknown>) => {
              posted = request;
              return of({ jobId: '' });
            },
          },
        },
      ],
    }).compileComponents();

    const fixture = await mount(draftWith('urn:li:sponsoredAccount:revoked-999'));

    const displayed = (fixture.componentInstance as unknown as { selectedLinkedInAccount(): { accountId: string } }).selectedLinkedInAccount();
    const internals = fixture.componentInstance as unknown as {
      selectedPlatforms: { set(v: string[]): void };
      campaignForm: { controls: Record<string, { setValue(v: unknown): void }> };
      linkedInVariants: { set(v: unknown[]): void };
      submit(): void;
    };

    // Everything `canSubmit` requires for a LinkedIn dispatch, so `submit()` reaches the service.
    // The geo list matters: `draftWith` carries none, and an empty one blocks the create (:417).
    internals.selectedPlatforms.set(['linkedin-ads']);
    internals.campaignForm.controls['eventName'].setValue('KubeCon EU 2026');
    internals.campaignForm.controls['registrationUrl'].setValue('https://example.com/kubecon');
    internals.campaignForm.controls['startDate'].setValue('2026-09-01');
    internals.campaignForm.controls['endDate'].setValue('2026-09-30');
    internals.campaignForm.controls['linkedInGeoTargets'].setValue([{ urn: 'urn:li:geo:103644278', label: 'United States' }]);
    internals.linkedInVariants.set([{ headline: 'Attend', introText: 'Join us', destinationUrl: 'https://example.com/kubecon' }]);
    fixture.detectChanges();

    internals.submit();

    const sent = (posted?.['linkedInConfig'] as { adAccountId: string } | undefined)?.adAccountId;
    expect(sent).toBe(displayed.accountId);
    // And specifically not the revoked id the draft carried.
    expect(sent).not.toBe('urn:li:sponsoredAccount:revoked-999');
  });
});
