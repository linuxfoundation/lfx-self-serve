// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { CampaignBriefOutput } from '@lfx-one/shared/interfaces';
import { CampaignService } from '@services/campaign.service';
import { ProjectContextService } from '@services/project-context.service';
import { MessageService } from 'primeng/api';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ImplementationTabComponent } from './implementation-tab.component';
import { stubCreativeLibraryUpload, STATE_ONLY, tabComponentUnderTest, trackStateOnlyTests } from './implementation-tab.spec-helper';

stubCreativeLibraryUpload();
trackStateOnlyTests();

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

  /** Mount a fresh component with a persisted draft naming `objective`, as a tab revisit would. */
  async function restoredWithObjective(objective: string): Promise<ComponentFixture<ImplementationTabComponent>> {
    const restored = TestBed.createComponent(tabComponentUnderTest());
    restored.componentRef.setInput('draft', {
      eventSlug: 'kubecon-eu-2026',
      metaObjective: objective,
      headlines: [''],
      descriptions: [''],
    });
    restored.componentRef.setInput('briefData', {
      eventDetails: { name: 'KubeCon EU 2026', slug: 'kubecon-eu-2026', registrationUrl: 'https://events.example.com/k' },
      selectedPlatforms: ['meta-ads'],
    } as unknown as CampaignBriefOutput);
    restored.detectChanges();
    await restored.whenStable();
    return restored;
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
        { provide: CampaignService, useValue: { createCampaign, getLinkedInAccounts: () => of([]), getLinkedInTargetingProfiles: () => of([]) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(tabComponentUnderTest());
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

  /**
   * The untouched form must submit successfully once the cutover is live.
   *
   * `createCampaigns` refuses a Google request carrying BOTH `search` and `demand-gen` and does
   * not fall back to the legacy creator, so defaulting both to true handed a user a terminal
   * failure on their very first create. `canSubmit` does not catch it either — it only blocks
   * when NEITHER is selected.
   *
   * Pinned as a default rather than as a rule, because that is what regressed: someone restoring
   * `includeDemandGen: [true]` for symmetry would reintroduce the dead end silently.
   */
  it('defaults Google to Search only, the combination the server accepts', STATE_ONLY, () => {
    const c = component() as unknown as Record<string, any>;
    expect(c['campaignForm'].controls['includeSearch'].value).toBe(true);
    expect(c['campaignForm'].controls['includeDemandGen'].value).toBe(false);
  });

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
  it('restores leads from a persisted draft', STATE_ONLY, async () => {
    const restored = await restoredWithObjective('leads');
    const c = restored.componentInstance as unknown as Record<string, any>;

    expect(c['metaObjective']()).toBe('leads');
  });

  /**
   * The DOM half, which the signal assertion above cannot cover — and the symptom is worse than
   * an empty field. The template selects per-`<option>` via `[selected]`, so a restored `leads`
   * with no matching option does not blank the control: Angular applies the binding while the
   * option does not yet exist, and the browser falls back to index 0. Before the disabled legacy
   * option existed this field displayed `awareness` — the FIRST selectable objective — a
   * confidently wrong value the operator could submit without ever noticing, while the signal
   * still held `leads`. Reverting the fix makes this test report exactly that: `expected
   * 'awareness' to be 'leads'`.
   *
   * Asserting `selectedIndex`, the value and the visible label is what binds the fix; a test that
   * stopped at the signal passed while the screen showed a different campaign than the wire sent.
   */
  it('shows the restored leads objective in the select rather than displaying the first selectable one', async () => {
    const restored = await restoredWithObjective('leads');
    const select = restored.nativeElement.querySelector('[data-testid="implementation-meta-objective"]') as HTMLSelectElement;

    expect(select.selectedIndex).toBeGreaterThanOrEqual(0);
    expect(select.value).toBe('leads');
    expect(select.options[select.selectedIndex].text).toContain('Leads');
  });

  /** Visible, but NOT newly choosable — the whole point of hiding it. */
  it('renders the restored leads objective as disabled', async () => {
    const restored = await restoredWithObjective('leads');
    const select = restored.nativeElement.querySelector('[data-testid="implementation-meta-objective"]') as HTMLSelectElement;
    const leadsOption = Array.from(select.options).find((o) => o.value === 'leads');

    expect(leadsOption?.disabled).toBe(true);
  });

  /** A restore affordance, not a permanent fifth option — it must not appear for a normal draft. */
  it('does not render the legacy option when the objective is selectable', async () => {
    const restored = await restoredWithObjective('engagement');
    const select = restored.nativeElement.querySelector('[data-testid="implementation-meta-objective"]') as HTMLSelectElement;

    expect(Array.from(select.options).map((o) => o.value)).toEqual(['awareness', 'traffic', 'engagement', 'conversions']);
  });

  /**
   * The other half of the same restore: an objective the picker CAN render must still round-trip,
   * so the assertion above cannot be satisfied by a restore path that ignores the draft entirely.
   */
  it('restores a selectable objective from a persisted draft', STATE_ONLY, async () => {
    const restored = await restoredWithObjective('engagement');
    const c = restored.componentInstance as unknown as Record<string, any>;

    expect(c['metaObjective']()).toBe('engagement');
  });

  /**
   * `traffic` matches what campaign-service assumes when `objective` is absent, so switching the
   * selector on cannot change the campaign an existing user would have got.
   */
  it('sends traffic as the default objective', STATE_ONLY, async () => {
    expect((await submittedMetaConfig())['objective']).toBe('traffic');
  });

  it('sends the objective the user picked', async () => {
    await selectObjective('awareness');

    expect((await submittedMetaConfig())['objective']).toBe('awareness');
  });

  // === Geo eligibility, and display/dispatch agreement ===

  /**
   * Wiring counterpart to the shared `metaGeoIsIneligible` / `metaAcceptedGeos` tables: the chip add
   * must still accept an eligible code, or geo targeting breaks outright.
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

  /** A restored draft is a door into `metaGeoTargets` too: it must drop a Meta-ineligible code, on screen as well as on the wire. */
  it('drops a Meta-ineligible geo carried by a restored draft', STATE_ONLY, async () => {
    const restored = TestBed.createComponent(tabComponentUnderTest());
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
  it('keeps eligible geos the brief recommended', STATE_ONLY, async () => {
    const seeded = TestBed.createComponent(tabComponentUnderTest());
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
  it('sends exactly the geo the empty-state line displays', STATE_ONLY, async () => {
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
    const restored = TestBed.createComponent(tabComponentUnderTest());
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
   * LFXV2-3312, the Microsoft equivalent of the Meta case above and asserted the same way: what
   * the REMOUNTED component would SUBMIT, not that the draft object carries the fields. The two
   * ARRAYS are the ones most likely to be missed — they need a draft field, an `emitDraft()` in
   * their handler AND an `applyDraft` restore arm, and losing either of them is silent.
   */
  it('carries the user Microsoft edits through a destroy/remount and into the request', STATE_ONLY, async () => {
    let draft: Record<string, any> | null = null;
    component()['draftChange'].subscribe((d: Record<string, any>) => (draft = d));

    component()['addMicrosoftGeoTarget']('jp');
    component()['addMicrosoftKeyword']('service mesh');
    component()['microsoftBudgetUsd'].set(1234);
    component()['microsoftCpcBid'].set('2.5');
    component()['emitDraft']();
    await fixture.whenStable();

    expect(draft).not.toBeNull();
    const draftSlug = (draft as unknown as Record<string, any>)['eventSlug'];

    const restored = TestBed.createComponent(tabComponentUnderTest());
    restored.componentRef.setInput('draft', draft);
    restored.componentRef.setInput('briefData', {
      eventDetails: { name: 'KubeCon EU 2026', slug: draftSlug, registrationUrl: 'https://events.example.com/kubecon-eu-2026' },
      selectedPlatforms: ['microsoft-ads'],
    } as unknown as CampaignBriefOutput);
    restored.detectChanges();
    await restored.whenStable();

    const c = restored.componentInstance as unknown as Record<string, any>;
    c['campaignForm'].controls['startDate'].setValue('2026-09-01');
    c['campaignForm'].controls['endDate'].setValue('2026-09-30');
    await restored.whenStable();

    createCampaign.mockClear();
    c['submit']();
    await restored.whenStable();

    expect(createCampaign).toHaveBeenCalled();
    const microsoftConfig = createCampaign.mock.calls[0][0].microsoftConfig;
    expect(microsoftConfig['geoTargets']).toContain('JP');
    expect(microsoftConfig['keywords']).toContainEqual({ text: 'service mesh', matchType: 'Phrase' });
    expect(microsoftConfig['budgetUsd']).toBe(1234);
    expect(microsoftConfig['cpcBid']).toBe(2.5);
  });

  /**
   * The add handlers refuse at the door, so the over-cap state is unreachable through the UI —
   * asserted by DRIVING the handler rather than writing the signal, because a test that sets the
   * signal directly would pass against a handler that does no checking at all.
   */
  it('refuses to add a keyword past the cap, or one longer than the limit', STATE_ONLY, async () => {
    const c = component() as unknown as Record<string, any>;
    c['microsoftKeywords'].set(Array.from({ length: 60 }, (_, i) => ({ text: `kw-${i}`, matchType: 'Exact' })));
    await fixture.whenStable();

    c['addMicrosoftKeyword']('one-too-many');
    expect(c['microsoftKeywords']().length).toBe(60);
    expect(c['microsoftKeywords']().some((k: { text: string }) => k.text === 'one-too-many')).toBe(false);

    c['microsoftKeywords'].set([]);
    c['addMicrosoftKeyword']('k'.repeat(101));
    expect(c['microsoftKeywords']()).toEqual([]);

    // The boundary itself is accepted — an off-by-one here would silently cost a keyword.
    c['addMicrosoftKeyword']('k'.repeat(100));
    expect(c['microsoftKeywords']().length).toBe(1);
  });

  /**
   * The box carries NO native `maxlength`: it counts UTF-16 units while every guard here counts
   * runes, so a cap of 100 would stop the field at 50 emoji and make a keyword the BFF accepts
   * impossible to type. The live counter is what provides the feedback instead.
   */
  it('accepts a 100-rune emoji keyword the UTF-16 length would have blocked', STATE_ONLY, async () => {
    const c = component() as unknown as Record<string, any>;
    const emoji = '\u{1F600}'.repeat(100);
    expect(emoji.length).toBe(200); // UTF-16 units — what a native maxlength would have counted

    c['microsoftKeywords'].set([]);
    c['addMicrosoftKeyword'](emoji);

    expect(c['microsoftKeywords']().length).toBe(1);
  });

  it('flags an over-length in-progress keyword by rune count', STATE_ONLY, async () => {
    const c = component() as unknown as Record<string, any>;

    c['microsoftKeywordDraft'].set('\u{1F600}'.repeat(100));
    await fixture.whenStable();
    expect(c['microsoftKeywordDraftLength']()).toBe(100);
    expect(c['microsoftKeywordDraftTooLong']()).toBe(false);

    c['microsoftKeywordDraft'].set('k'.repeat(101));
    await fixture.whenStable();
    expect(c['microsoftKeywordDraftTooLong']()).toBe(true);
  });

  /**
   * Regression: the add handler is bound to `(change)` as well as Enter, so simply BLURRING the
   * box ran it. Clearing unconditionally discarded the over-length text the warning was asking the
   * operator to shorten — and took the warning with it. Driven through the DOM event rather than
   * by calling the handler, because the `(change)`-on-blur path is the one that made it reachable.
   */
  it('keeps a refused keyword in the box instead of wiping it on blur', async () => {
    const c = component() as unknown as Record<string, any>;
    c['selectedPlatforms'].set(['microsoft-ads']);
    fixture.detectChanges();
    await fixture.whenStable();

    const input: HTMLInputElement = fixture.nativeElement.querySelector('[data-testid="implementation-microsoft-keyword-add"]');
    expect(input).not.toBeNull();

    const tooLong = 'k'.repeat(101);
    input.value = tooLong;
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('change'));
    await fixture.whenStable();

    // Not added, and NOT discarded — the operator can still shorten what they typed.
    expect(c['microsoftKeywords']()).toEqual([]);
    expect(input.value).toBe(tooLong);
    expect(c['microsoftKeywordDraft']()).toBe(tooLong);
    expect(c['microsoftKeywordDraftTooLong']()).toBe(true);
  });

  /**
   * Uniqueness is `(matchType, case-folded text)`, matching the client's `validateKeywords`
   * (`internal/platform/microsoft/targeting.go`, key `matchType + "\x00" + strings.ToLower(text)`).
   *
   * A text-ONLY check rejected configurations campaign-service accepts, and the operator had no
   * way around it: new rows are added at `MICROSOFT_NEW_KEYWORD_MATCH_TYPE` and the match type is
   * only changeable AFTER the row exists, so a seeded or restored `kubernetes/Exact` made
   * `kubernetes/Phrase` permanently unreachable — the add was refused before its match type could
   * be changed.
   *
   * The case fold must SURVIVE the change: same text, same match type, different casing is still
   * one keyword upstream, and admitting it would overstate coverage.
   */
  it('scopes the duplicate check to the match type the new row will carry', STATE_ONLY, async () => {
    const c = component() as unknown as Record<string, any>;
    c['selectedPlatforms'].set(['microsoft-ads']);

    // Seeded at Exact — the match type a new row does NOT get.
    c['microsoftKeywords'].set([{ text: 'kubernetes', matchType: 'Exact' }]);
    expect(c['addMicrosoftKeyword']('kubernetes')).toBe(true);
    expect(c['microsoftKeywords']()).toEqual([
      { text: 'kubernetes', matchType: 'Exact' },
      { text: 'kubernetes', matchType: 'Phrase' },
    ]);

    // Now the Phrase row exists, so the same text at Phrase IS a duplicate — including a case
    // variant, which is one keyword upstream.
    expect(c['addMicrosoftKeyword']('kubernetes')).toBe(false);
    expect(c['addMicrosoftKeyword']('KUBERNETES')).toBe(false);
    expect(c['microsoftKeywords']().length).toBe(2);
  });

  /**
   * The add-time guard can only refuse a NEW row. `onMicrosoftKeywordMatchTypeChange` can move an
   * EXISTING row onto another's `(matchType, text)` afterwards — start at `kubernetes/Exact`, add
   * `kubernetes/Phrase`, then switch the second row back to `Exact`.
   *
   * The client does not reject that: `validateKeywords` drops the duplicate with `continue`, so
   * the create SUCCEEDS having made one keyword while the form still showed two. The failure is a
   * silent undercount, not a failed job — which is why the fix is de-duping the effective list
   * (the signal every count and the payload derive from) rather than only refusing the edit.
   */
  it('does not let a match-type edit smuggle a duplicate past the effective list', STATE_ONLY, async () => {
    const c = component() as unknown as Record<string, any>;
    c['selectedPlatforms'].set(['microsoft-ads']);
    c['microsoftKeywords'].set([
      { text: 'kubernetes', matchType: 'Exact' },
      { text: 'kubernetes', matchType: 'Phrase' },
    ]);
    expect(c['microsoftEffectiveKeywords']().length).toBe(2);
    expect(c['microsoftDuplicateKeywordCount']()).toBe(0);

    // Move row 1 onto row 0's pair, the way the <select> does.
    c['onMicrosoftKeywordMatchTypeChange'](1, { target: { value: 'Exact' } } as unknown as Event);

    // The operator's rows are kept intact...
    expect(c['microsoftKeywords']().length).toBe(2);
    // ...but only ONE keyword is actually sent, and the form says so rather than claiming two.
    expect(c['microsoftEffectiveKeywords']()).toEqual([{ text: 'kubernetes', matchType: 'Exact' }]);
    expect(c['microsoftDuplicateKeywordCount']()).toBe(1);
  });

  /**
   * The case fold has to survive into the effective list too: `Kubernetes/Exact` and
   * `kubernetes/Exact` are ONE keyword upstream, so a restore carrying both must not report two.
   * `populateFromBrief` applies no uniqueness filter, so this arrives from the server, not the UI.
   */
  it('folds case when de-duping the effective keyword list', STATE_ONLY, async () => {
    const c = component() as unknown as Record<string, any>;
    c['selectedPlatforms'].set(['microsoft-ads']);
    c['microsoftKeywords'].set([
      { text: 'Kubernetes', matchType: 'Exact' },
      { text: 'kubernetes', matchType: 'Exact' },
      { text: 'kubernetes', matchType: 'Phrase' },
    ]);

    // First occurrence wins, keeping the operator's original casing — as the client does.
    expect(c['microsoftEffectiveKeywords']()).toEqual([
      { text: 'Kubernetes', matchType: 'Exact' },
      { text: 'kubernetes', matchType: 'Phrase' },
    ]);
    expect(c['microsoftDuplicateKeywordCount']()).toBe(1);
  });

  /**
   * The cap has to count what the REQUEST carries, not how many rows are on screen. Once the
   * effective list de-dupes, a duplicate row consumes cap the request never spends: 60 raw rows
   * containing one duplicate are 59 keywords upstream, so refusing the 60th unique keyword
   * blocks a configuration Microsoft would accept — and no removal short of deleting the
   * duplicate ever unblocks it.
   *
   * The label and the add-box visibility already read the effective length, so the raw count
   * also disagreed with what the operator was being shown: 59/60 with the box open, and the add
   * silently refused.
   */
  it('counts the cap on the keywords the request will carry', STATE_ONLY, async () => {
    const c = component() as unknown as Record<string, any>;
    c['selectedPlatforms'].set(['microsoft-ads']);

    // 60 rows, but two share a (matchType, text) pair — so only 59 are sent.
    const rows = Array.from({ length: 59 }, (_, i) => ({ text: `kw-${i}`, matchType: 'Exact' as const }));
    rows.push({ text: 'kw-0', matchType: 'Exact' as const });
    c['microsoftKeywords'].set(rows);
    expect(c['microsoftKeywords']().length).toBe(60);
    expect(c['microsoftEffectiveKeywords']().length).toBe(59);

    // There is room for one more, and the operator is being told so.
    expect(c['addMicrosoftKeyword']('one-more')).toBe(true);
    expect(c['microsoftEffectiveKeywords']().length).toBe(60);

    // Now genuinely full: the next add is refused on the effective count.
    expect(c['addMicrosoftKeyword']('over-the-line')).toBe(false);
    expect(c['microsoftEffectiveKeywords']().length).toBe(60);
  });

  it('clears the box once a keyword is actually added', async () => {
    const c = component() as unknown as Record<string, any>;
    c['selectedPlatforms'].set(['microsoft-ads']);
    fixture.detectChanges();
    await fixture.whenStable();

    const input: HTMLInputElement = fixture.nativeElement.querySelector('[data-testid="implementation-microsoft-keyword-add"]');
    input.value = 'service mesh';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('change'));
    await fixture.whenStable();

    expect(c['microsoftKeywords']().some((k: { text: string }) => k.text === 'service mesh')).toBe(true);
    expect(input.value).toBe('');
    expect(c['microsoftKeywordDraft']()).toBe('');
  });

  /**
   * The add handler refuses the same control characters the BFF and the client do, across the FULL
   * C0/DEL/C1 range — U+0085 is the one an earlier version missed. U+00A0 must still be accepted:
   * Go reports `IsControl(U+00A0) == false`, so refusing it would block a valid keyword.
   */
  it.each([
    ['a C0 tab', 'kuber\tnetes', false],
    ['DEL U+007F', 'kuber\u007Fnetes', false],
    ['C1 NEL U+0085', 'kuber\u0085netes', false],
    ['C1 APC U+009F', 'kuber\u009Fnetes', false],
    ['a non-breaking space U+00A0', 'kuber\u00A0netes', true],
  ])('handles %s in a keyword', STATE_ONLY, async (_label, text, shouldAdd) => {
    const c = component() as unknown as Record<string, any>;
    c['microsoftKeywords'].set([]);

    c['addMicrosoftKeyword'](text);

    expect(c['microsoftKeywords']().length).toBe(shouldAdd ? 1 : 0);
  });

  /**
   * Brief-generated keywords carry the model's RAW `match_type` (both streams copy it through), so
   * `EXACT` reaches the seed. It must be canonicalised: the `<select>` offers only PascalCase, so a
   * raw value rendered the dropdown with NOTHING selected on a keyword that would dispatch fine.
   * Anything not canonicalisable is dropped, since the BFF would refuse the whole config for it.
   */
  it('canonicalises brief match types and drops ones Microsoft rejects', STATE_ONLY, async () => {
    const restored = TestBed.createComponent(tabComponentUnderTest());
    restored.componentRef.setInput('briefData', {
      eventDetails: { name: 'KubeCon EU 2026', slug: 'kubecon-eu-2026' },
      keywords: [
        { term: 'kubernetes', matchType: 'EXACT', intentLevel: 'High', notes: '' },
        { term: 'service mesh', matchType: '  broad  ', intentLevel: 'High', notes: '' },
        { term: 'observability', matchType: 'BROAD_MATCH', intentLevel: 'High', notes: '' },
      ],
      selectedPlatforms: ['microsoft-ads'],
    } as unknown as CampaignBriefOutput);
    restored.detectChanges();
    await restored.whenStable();

    const c = restored.componentInstance as unknown as Record<string, any>;
    expect(c['microsoftKeywords']()).toEqual([
      { text: 'kubernetes', matchType: 'Exact' },
      { text: 'service mesh', matchType: 'Broad' },
    ]);
  });
});
