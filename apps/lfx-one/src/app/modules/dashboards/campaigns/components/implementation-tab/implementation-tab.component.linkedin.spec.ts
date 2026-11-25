// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { LINKEDIN_GEO_SEARCH_DEBOUNCE_MS } from '@lfx-one/shared/constants';
import type { CampaignBriefOutput, CampaignImplementationDraft } from '@lfx-one/shared/interfaces';
import { CampaignService } from '@services/campaign.service';
import { ProjectContextService } from '@services/project-context.service';
import { MessageService } from 'primeng/api';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImplementationTabComponent } from './implementation-tab.component';
import { stubCreativeLibraryUpload, STATE_ONLY, tabComponentUnderTest, trackStateOnlyTests } from './implementation-tab.spec-helper';

stubCreativeLibraryUpload();
trackStateOnlyTests();

/**
 * The LinkedIn section across a tab switch: what the operator set survives the round-trip and reaches the request.
 * The rules themselves (the daily cap, the account fields, Create's refusals) are table rows in
 * `campaign-linkedin-form.utils.spec.ts` (#5980); these specs keep the wiring.
 */
describe('ImplementationTabComponent linkedin round-trip across a tab switch', () => {
  /** Matches the slug on the brief below — `applyDraft` ignores a draft keyed to another event. */
  const EVENT_SLUG = 'kubecon-eu-2026';

  /** Two real LinkedIn geo URNs. */
  const US_GEO = { urn: 'urn:li:geo:103644278', label: 'United States' };
  const DE_GEO = { urn: 'urn:li:geo:101282230', label: 'Germany' };

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
    addGeoTarget(geo: { urn: string; label: string }): void;
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
    const f = TestBed.createComponent(tabComponentUnderTest());
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
  // The rule is table rows in `campaign-linkedin-config.utils.spec.ts` (LFXV2-2665); this proves the restore applies it.
  it('restores a Germany saved with the old shared map as the real Germany', STATE_ONLY, async () => {
    const first = await mount(null);
    // Any edit emits the draft; the saved Germany below is what a draft written before the fix carries.
    at(first.fixture).addGeoTarget(DE_GEO);
    first.fixture.detectChanges();
    const saved = { ...(first.latest() as CampaignImplementationDraft), linkedInGeoTargets: [{ label: 'Germany', urn: 'urn:li:geo:101165590' }] };
    first.fixture.destroy();

    const second = await mount(saved);

    expect(at(second.fixture).linkedInGeoTargets()).toEqual([DE_GEO]);
  });

  it('keeps a removed geo target removed after a tab round-trip', STATE_ONLY, async () => {
    const first = await mount(null);
    at(first.fixture).addGeoTarget(DE_GEO);
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

  it('keeps an added geo target after a tab round-trip', STATE_ONLY, async () => {
    const first = await mount(null);
    at(first.fixture).addGeoTarget(DE_GEO);
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

  it('keeps a switched targeting profile after a tab round-trip', STATE_ONLY, async () => {
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
  it('keeps an emptied geo list empty after a tab round-trip', STATE_ONLY, async () => {
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

  it('keeps a chosen ad account after a tab round-trip', STATE_ONLY, async () => {
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
  it('still seeds from the brief on a first visit with no draft', STATE_ONLY, async () => {
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
  it('seeds from the brief when the carried draft belongs to another event', STATE_ONLY, async () => {
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
      includePerformanceMax: false,
      includeVideo: false,
      includeDisplay: false,
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
    const f = TestBed.createComponent(tabComponentUnderTest());
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
        { provide: CampaignService, useValue: { getLinkedInAccounts: () => accountsSubject.asObservable(), getLinkedInTargetingProfiles: () => of([]) } },
      ],
    }).compileComponents();
  });

  it('defaults to the first account when nothing is restored', STATE_ONLY, async () => {
    const fixture = await mount(null);

    expect(accountId(fixture)).toBe(ACCOUNTS[0].accountId);
  });

  /** The guard's reason for existing: a restored choice must outlive the fetch that follows it. */
  it('keeps a restored account rather than defaulting over it', STATE_ONLY, async () => {
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
   * The catalog membership gate, wired: before the account request returns, a restored id sits
   * unverified on the form with `linkedInAccounts()` empty, so `canSubmit` holds the create. The rule
   * itself (membership, not a non-empty id, and skipped when the connection decides the account) is
   * the `linkedInCreateRefusal` table in `campaign-linkedin-form.utils.spec.ts` (#5980).
   */
  it('blocks a linkedin create while the account catalog is still loading', STATE_ONLY, async () => {
    const f = TestBed.createComponent(tabComponentUnderTest());
    f.componentRef.setInput('draft', draftWith(ACCOUNTS[1].accountId));
    f.componentRef.setInput('briefData', brief());
    f.detectChanges();
    await f.whenStable();
    // Deliberately do NOT release accountsSubject: the fetch is still in flight.

    makeLinkedInOtherwiseValid(f);

    expect((f.componentInstance as unknown as { canSubmit(): boolean }).canSubmit()).toBe(false);
  });

  /**
   * #5809: when campaign-service owns the create, the connection decides the LinkedIn account and
   * `adAccountId` is dropped server-side, so the selector is replaced with a read-only line. Unknown
   * or `false` keeps the selector, because the legacy creator still reads the chosen account.
   */
  it.each([
    [true, true, false],
    [false, false, true],
    [null, false, true],
  ])('with googleCreativeEnabled %s shows the read-only account line: %s, the selector: %s', async (capability, readOnly, selector) => {
    const f = await mount(draftWith(ACCOUNTS[1].accountId));
    f.componentRef.setInput('googleCreativeEnabled', capability);
    makeLinkedInOtherwiseValid(f);
    f.detectChanges();
    await f.whenStable();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="implementation-linkedin-account-from-connection"]') !== null).toBe(readOnly);
    expect(el.querySelector('[data-testid="implementation-linkedin-account"]') !== null).toBe(selector);
  });

  /**
   * #5809 with account selection on: the account comes from campaign-service's `create-account` read.
   * A caller who may choose gets a picker; anyone else sees the default read-only. Only a chosen
   * NON-default account is sent as `adAccountId`, because campaign-service refuses any `adAccountId`
   * (the default included) from a caller without `global_marketing_ops` while its selection is on.
   */
  describe('account selection (#5809)', () => {
    const DEFAULT_ACCOUNT = { accountId: '100000001', orgId: '200000001', label: 'Shared system account', isDefault: true };
    const GRANT = { accountId: '100000002', orgId: '200000002', label: 'Grant One', isDefault: false };
    const chooser = {
      accountId: '100000001',
      orgId: '200000001',
      label: 'Shared system account',
      source: 'system',
      canChoose: true,
      accounts: [DEFAULT_ACCOUNT, GRANT],
    };
    const viewer = { ...chooser, canChoose: false, accounts: [DEFAULT_ACCOUNT] };

    let createAccountSubject: Subject<typeof chooser>;
    let createAccountCalls: string[];
    let posted: Record<string, unknown> | null;

    beforeEach(async () => {
      TestBed.resetTestingModule();
      accountsSubject = new Subject<typeof ACCOUNTS>();
      createAccountSubject = new Subject<typeof chooser>();
      createAccountCalls = [];
      posted = null;
      await TestBed.configureTestingModule({
        imports: [ImplementationTabComponent],
        providers: [
          provideHttpClient(),
          provideHttpClientTesting(),
          provideRouter([]),
          { provide: ProjectContextService, useValue: { activeContext: signal({ slug: 'tlf' }) } },
          { provide: MessageService, useValue: { add: vi.fn() } },
          {
            provide: CampaignService,
            useValue: {
              getLinkedInAccounts: () => accountsSubject.asObservable(),
              getLinkedInTargetingProfiles: () => of([]),
              getLinkedInCreateAccount: (slug: string) => {
                createAccountCalls.push(slug);
                return createAccountSubject.asObservable();
              },
              createCampaign: (request: Record<string, unknown>) => {
                posted = request;
                return of({ jobId: '' });
              },
            },
          },
        ],
      }).compileComponents();
    });

    async function mountWithSelection(selection: boolean | null): Promise<ComponentFixture<ImplementationTabComponent>> {
      const f = TestBed.createComponent(tabComponentUnderTest());
      f.componentRef.setInput('draft', draftWith(ACCOUNTS[1].accountId));
      f.componentRef.setInput('briefData', brief());
      f.componentRef.setInput('googleCreativeEnabled', true);
      f.componentRef.setInput('linkedInAccountSelectionEnabled', selection);
      f.detectChanges();
      await f.whenStable();
      accountsSubject.next(ACCOUNTS);
      accountsSubject.complete();
      makeLinkedInOtherwiseValid(f);
      f.detectChanges();
      await f.whenStable();
      return f;
    }

    async function answer(f: ComponentFixture<ImplementationTabComponent>, payload: typeof chooser): Promise<void> {
      createAccountSubject.next(payload);
      f.detectChanges();
      await f.whenStable();
    }

    const el = (f: ComponentFixture<ImplementationTabComponent>, testId: string): HTMLElement | null =>
      (f.nativeElement as HTMLElement).querySelector(`[data-testid="${testId}"]`);

    /** Neither the picker's field nor the legacy `adAccountId` goes out: the create uses the default. */
    function expectNoAccountSent(sent: Record<string, unknown>): void {
      expect(sent).not.toHaveProperty('selectedAdAccountId');
      expect(sent).not.toHaveProperty('adAccountId');
    }

    /** What the operator picks in the `lfx-select`: it writes the form control, so the test does too. */
    function pick(f: ComponentFixture<ImplementationTabComponent>, accountId: string): void {
      (
        f.componentInstance as unknown as { linkedInCreateAccountForm: { controls: { accountId: { setValue(v: string): void } } } }
      ).linkedInCreateAccountForm.controls.accountId.setValue(accountId);
      f.detectChanges();
    }

    function submitAndRead(f: ComponentFixture<ImplementationTabComponent>): Record<string, unknown> {
      (f.componentInstance as unknown as { submit(): void }).submit();
      return (posted?.['linkedInConfig'] ?? {}) as Record<string, unknown>;
    }

    it.each([null, false])('reads nothing and keeps the generic line while account selection is %s', async (selection) => {
      const f = await mountWithSelection(selection);

      expect(createAccountCalls).toEqual([]);
      expect(el(f, 'implementation-linkedin-account-from-connection')).not.toBeNull();
      expectNoAccountSent(submitAndRead(f));
    });

    it('holds Create while the account is loading, then offers global_marketing_ops a picker', async () => {
      const f = await mountWithSelection(true);
      const c = f.componentInstance as unknown as { canSubmit(): boolean };

      expect(createAccountCalls).toEqual(['tlf']);
      expect(el(f, 'implementation-linkedin-create-account-loading')).not.toBeNull();
      expect(c.canSubmit()).toBe(false);

      await answer(f, chooser);

      expect(el(f, 'implementation-linkedin-create-account-select')).not.toBeNull();
      const options = (f.componentInstance as unknown as { linkedInCreateAccountOptions(): { label: string; value: string }[] }).linkedInCreateAccountOptions();
      expect(options).toEqual([
        { label: 'Shared system account (100000001) · default', value: '100000001' },
        { label: 'Grant One (100000002)', value: '100000002' },
      ]);
      expect(c.canSubmit()).toBe(true);
    });

    it('sends a chosen grant as selectedAdAccountId', async () => {
      const f = await mountWithSelection(true);
      await answer(f, chooser);

      // The custom targeting editor reads the segments of the account the create names: the default until a grant is picked.
      const audienceAccount = (f.componentInstance as unknown as { linkedInAudienceAccountId(): string | null }).linkedInAudienceAccountId;
      expect(audienceAccount()).toBeNull();
      pick(f, GRANT.accountId);
      expect(audienceAccount()).toBe(GRANT.accountId);

      expect(el(f, 'implementation-linkedin-create-account-page')?.textContent).toContain(GRANT.orgId);
      const sent = submitAndRead(f);
      expect(sent['selectedAdAccountId']).toBe(GRANT.accountId);
      // The legacy linkedin.json id the form still carries is not sent on this road.
      expect(sent).not.toHaveProperty('adAccountId');
    });

    it('shows anyone who cannot choose the default read-only and sends no account', async () => {
      const f = await mountWithSelection(true);
      await answer(f, viewer);

      expect(el(f, 'implementation-linkedin-create-account-select')).toBeNull();
      expect(el(f, 'implementation-linkedin-create-account-default')?.textContent).toContain('Shared system account (100000001)');
      // Not the legacy linkedin.json id the form still carries either.
      expectNoAccountSent(submitAndRead(f));
    });

    it('lets a create through to the default when the account read fails', async () => {
      const f = await mountWithSelection(true);
      createAccountSubject.error(new Error('create-account unavailable'));
      f.detectChanges();
      await f.whenStable();

      expect(el(f, 'implementation-linkedin-create-account-failed')).not.toBeNull();
      expect((f.componentInstance as unknown as { canSubmit(): boolean }).canSubmit()).toBe(true);
      expectNoAccountSent(submitAndRead(f));
    });
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
  it('blocks a linkedin create when the geo target list is empty', STATE_ONLY, async () => {
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
  it('blocks rather than crashing when the restored geo list is absent', STATE_ONLY, async () => {
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
    c.linkedInVariants.set([
      { key: 'linkedin-variant-test', headline: 'Attend', introText: 'Join us', imageAssetId: '', imageAssetName: '', imageAssetBriefId: '' },
    ]);
    f.detectChanges();
  }

  it('clears a restored account when the catalog comes back empty', STATE_ONLY, async () => {
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
  it('emits the corrected account to the parent draft', STATE_ONLY, async () => {
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
  it('does not dispatch to an account the page is not displaying', STATE_ONLY, async () => {
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
            getLinkedInTargetingProfiles: () => of([]),
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
      linkedInAudienceAccountId(): string | null;
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
    internals.linkedInVariants.set([
      { key: 'linkedin-variant-test', headline: 'Attend', introText: 'Join us', imageAssetId: '', imageAssetName: '', imageAssetBriefId: '' },
    ]);
    fixture.detectChanges();

    internals.submit();

    const sent = (posted?.['linkedInConfig'] as { adAccountId: string } | undefined)?.adAccountId;
    expect(sent).toBe(displayed.accountId);
    // The custom targeting editor reads the segments of the same account the legacy create sends.
    expect(internals.linkedInAudienceAccountId()).toBe(displayed.accountId);
    // And specifically not the revoked id the draft carried.
    expect(sent).not.toBe('urn:li:sponsoredAccount:revoked-999');
  });
});

/**
 * The LinkedIn ad variants (#5547): each one's intro text and headline are edited in the tab,
 * variants are added and removed between `LINKEDIN_MIN_VARIANTS` and `LINKEDIN_MAX_VARIANTS`, and
 * each takes its OWN image upload, sent as that variant's `imageAssetId` (the dark post's
 * thumbnail). LinkedIn takes no image URL, so the upload is offered on an explicit yes from
 * `linkedInAssetUploadEnabled` and there is nothing else. With it off, the variants go out without one.
 */
describe('ImplementationTabComponent linkedin ad variants', () => {
  const BRIEF_ID = '6f9619ff-8b86-d011-b42d-00c04fc964ff';
  const ASSET_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
  const ACCOUNT = { accountId: 'urn:li:sponsoredAccount:111', label: 'First Account', orgId: 'urn:li:organization:1', status: 'ACTIVE' };

  let createCampaign: ReturnType<typeof vi.fn>;
  let uploadCreativeAsset: ReturnType<typeof vi.fn>;
  let resumeCreativeAssetUpload: ReturnType<typeof vi.fn>;
  let cancelCreativeAssetUpload: ReturnType<typeof vi.fn>;
  const deleteCreativeAsset = vi.fn(() => of(undefined));
  const searchLinkedInGeoTargets = vi.fn();

  interface Internals {
    campaignForm: { controls: Record<string, { setValue(v: unknown): void }> };
    selectedPlatforms: { set(v: string[]): void };
    linkedInVariants: () => { key: string; imageAssetId: string }[];
    linkedInImageUploadStatus: () => string;
    linkedInImageUploadError: () => string;
    createBlockedReason: () => string | null;
    canSubmit: () => boolean;
    addLinkedInVariant(): void;
    removeLinkedInVariant(key: string): void;
    onLinkedInVariantTextChange(key: string, field: string, value: string): void;
    submit(): void;
  }
  const at = (f: ComponentFixture<ImplementationTabComponent>): Internals => f.componentInstance as unknown as Internals;
  const q = (f: ComponentFixture<ImplementationTabComponent>, id: string): HTMLElement | null =>
    f.nativeElement.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
  const click = (f: ComponentFixture<ImplementationTabComponent>, id: string): void => {
    (q(f, id)?.querySelector('button') as HTMLButtonElement).click();
    f.detectChanges();
  };
  const buttonDisabled = (f: ComponentFixture<ImplementationTabComponent>, id: string): boolean =>
    (q(f, id)?.querySelector('button') as HTMLButtonElement).disabled;
  /** Type into a variant's intro text (a textarea) or headline (an input), as the operator does. */
  function type(f: ComponentFixture<ImplementationTabComponent>, id: string, value: string): void {
    const box = q(f, id)?.querySelector('textarea, input') as HTMLInputElement | HTMLTextAreaElement;
    box.value = value;
    box.dispatchEvent(new Event('input'));
    f.detectChanges();
  }

  const briefVariants = (): { introText: string; headline: string; imageUrn?: string }[] => [
    { introText: 'First intro', headline: 'First headline' },
    { introText: 'Second intro', headline: 'Second headline', imageUrn: 'urn:li:image:C4D10AQ' },
  ];
  const brief = (variants = briefVariants()): CampaignBriefOutput =>
    ({
      eventDetails: { name: 'KubeCon EU 2026', slug: 'kubecon-eu-2026', countryCode: 'US', registrationUrl: 'https://example.com/kubecon' },
      totalBudget: 500,
      selectedPlatforms: ['linkedin-ads'],
      linkedInCopy: {
        variants,
        recommendedGeoTargets: [{ urn: 'urn:li:geo:103644278', label: 'United States' }],
        recommendedTargetingProfile: 'cloud-native',
      },
      keywords: [],
      hsUtm: null,
      driveFolderUrl: '',
    }) as unknown as CampaignBriefOutput;

  async function mount(
    upload: boolean | null,
    draft: CampaignImplementationDraft | null = null,
    briefData: CampaignBriefOutput = brief()
  ): Promise<{ fixture: ComponentFixture<ImplementationTabComponent>; latest: () => CampaignImplementationDraft | null }> {
    const f = TestBed.createComponent(tabComponentUnderTest());
    let captured: CampaignImplementationDraft | null = null;
    f.componentRef.instance.draftChange.subscribe((d: CampaignImplementationDraft) => (captured = d));
    if (draft) f.componentRef.setInput('draft', draft);
    f.componentRef.setInput('linkedInAssetUploadEnabled', upload);
    f.componentRef.setInput('briefPersistence', { status: 'saved', briefId: BRIEF_ID, message: null, approved: true });
    f.componentRef.setInput('briefData', briefData);
    at(f).selectedPlatforms.set(['linkedin-ads']);
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
    return { fixture: f, latest: () => captured };
  }

  function choose(f: ComponentFixture<ImplementationTabComponent>, file: File, variant = 0): void {
    const input = q(f, `implementation-linkedin-variant-image-file-${variant}`) as HTMLInputElement;
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    input.dispatchEvent(new Event('change'));
    f.detectChanges();
  }

  const png = (size = 16, name = 'promo.png'): File => new File([new Uint8Array(size)], name, { type: 'image/png' });
  const stored = (id = ASSET_ID) => of({ id, mimeType: 'image/png', byteSize: 16, checksum: 'ab'.repeat(32), created: true });

  /** The draft a real upload onto the first variant leaves behind, as a tab switch hands it to the next mount. */
  async function uploadedDraft(): Promise<CampaignImplementationDraft> {
    const first = await mount(true);
    choose(first.fixture, png());
    const draft = { ...(first.latest() as CampaignImplementationDraft), eventSlug: 'kubecon-eu-2026' };
    first.fixture.destroy();
    return draft;
  }

  function fillForm(f: ComponentFixture<ImplementationTabComponent>): void {
    const c = at(f);
    c.campaignForm.controls['eventName'].setValue('KubeCon EU 2026');
    c.campaignForm.controls['registrationUrl'].setValue('https://example.com/kubecon');
    c.campaignForm.controls['startDate'].setValue('2026-09-01');
    c.campaignForm.controls['endDate'].setValue('2026-09-30');
    f.detectChanges();
  }

  function submitVariants(f: ComponentFixture<ImplementationTabComponent>): Record<string, unknown>[] {
    fillForm(f);
    at(f).submit();
    expect(createCampaign).toHaveBeenCalled();
    return (createCampaign.mock.calls[0][0]['linkedInConfig'] as { variants: Record<string, unknown>[] }).variants;
  }

  beforeEach(async () => {
    createCampaign = vi.fn().mockReturnValue(of({ result: { campaigns: [], errors: [] } }));
    uploadCreativeAsset = vi.fn().mockReturnValue(stored());
    resumeCreativeAssetUpload = vi.fn().mockReturnValue(null);
    cancelCreativeAssetUpload = vi.fn();

    await TestBed.configureTestingModule({
      imports: [ImplementationTabComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: ProjectContextService, useValue: { activeContext: () => ({ slug: 'tlf' }) } },
        { provide: MessageService, useValue: { add: vi.fn() } },
        {
          provide: CampaignService,
          useValue: {
            createCampaign,
            uploadCreativeAsset,
            resumeCreativeAssetUpload,
            forgetCreativeAssetUpload: vi.fn(),
            cancelCreativeAssetUpload,
            deleteCreativeAsset,
            getLinkedInAccounts: () => of([ACCOUNT]),
            getLinkedInTargetingProfiles: () => of([]),
            getCreativeAssetPlan: () => of({ platforms: [], assignments: [], gaps: [], unclassified: [], unused: [] }),
            searchLinkedInGeoTargets: (...args: unknown[]) => searchLinkedInGeoTargets(...args),
          },
        },
      ],
    }).compileComponents();
  });

  // The location search (#5545); its rules are rows in `campaign-linkedin-geo.utils.spec.ts`.
  describe('location search', () => {
    afterEach(() => vi.useRealTimers());

    it('searches after the debounce, offers each location once, and sends the one picked', STATE_ONLY, async () => {
      const BERLIN = { urn: 'urn:li:geo:103035651', label: 'Berlin, Germany' };
      const US = { urn: 'urn:li:geo:103644278', label: 'United States' };
      searchLinkedInGeoTargets.mockReturnValue(of({ locations: [BERLIN, US] }));
      const f = (await mount(null)).fixture;
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
      const c = f.componentInstance as unknown as {
        onLinkedInGeoSearch(event: { query: string }): void;
        onLinkedInGeoSearchSelect(event: { value: unknown }): void;
        onLinkedInGeoSearchInput(event: { target: { value: string } }): void;
        linkedInGeoSearchQuery(): string;
        linkedInGeoSearchOptions(): { urn: string; disabled: boolean }[];
      };

      c.onLinkedInGeoSearch({ query: '  Berlin ' });
      f.detectChanges();
      await vi.advanceTimersByTimeAsync(LINKEDIN_GEO_SEARCH_DEBOUNCE_MS);
      f.detectChanges();

      expect(searchLinkedInGeoTargets).toHaveBeenCalledWith('tlf', 'Berlin');
      // The brief already targets the United States, so that row is offered but disabled.
      expect(c.linkedInGeoSearchOptions()).toEqual([
        { ...BERLIN, disabled: false },
        { ...US, disabled: true },
      ]);

      // Deleting back below two characters, where PrimeNG emits nothing, clears the query and so cancels the search.
      c.onLinkedInGeoSearch({ query: 'Be' });
      c.onLinkedInGeoSearchInput({ target: { value: 'B' } });
      expect(c.linkedInGeoSearchQuery()).toBe('');

      c.onLinkedInGeoSearchSelect({ value: { ...BERLIN, disabled: false } });
      vi.useRealTimers();
      fillForm(f);
      at(f).submit();
      expect((createCampaign.mock.calls[0][0]['linkedInConfig'] as { geoTargets: unknown }).geoTargets).toEqual([US, BERLIN]);
    });
  });

  describe('copy', () => {
    it('seeds one editable variant per brief variant and sends the brief copy untouched', async () => {
      const f = (await mount(null)).fixture;

      expect((q(f, 'implementation-linkedin-variant-intro-0')?.querySelector('textarea') as HTMLTextAreaElement).value).toBe('First intro');
      expect((q(f, 'implementation-linkedin-variant-headline-1')?.querySelector('input') as HTMLInputElement).value).toBe('Second headline');
      expect(submitVariants(f)).toEqual(briefVariants());
    });

    // The ad name, description and call to action (#5764 rows 16–17); the rules are rows in
    // `campaign-linkedin-variant-fields.utils.spec.ts` and `campaign-linkedin-form.utils.spec.ts`.
    it('offers the ad name, description and call to action only on an explicit yes, and sends them as set', async () => {
      const f = (await mount(null)).fixture;
      expect(q(f, 'implementation-linkedin-variant-name-0')).toBeNull();
      expect(q(f, 'implementation-linkedin-variant-cta-0')).toBeNull();

      f.componentRef.setInput('linkedInVariantCopyEnabled', true);
      f.componentRef.setInput('linkedInCallToActionEnabled', true);
      f.detectChanges();
      type(f, 'implementation-linkedin-variant-name-1', 'Ad two');
      type(f, 'implementation-linkedin-variant-description-1', 'Two days of talks');
      at(f).onLinkedInVariantTextChange(at(f).linkedInVariants()[1].key, 'callToAction', 'REGISTER');

      expect(submitVariants(f)).toEqual([
        { introText: 'First intro', headline: 'First headline' },
        {
          introText: 'Second intro',
          headline: 'Second headline',
          imageUrn: 'urn:li:image:C4D10AQ',
          name: 'Ad two',
          description: 'Two days of talks',
          callToAction: 'REGISTER',
        },
      ]);
    });

    // Text Ads (#5764 row 19); the rules are rows in `campaign-linkedin-text-ads-form.utils.spec.ts` and
    // `campaign-linkedin-form.utils.spec.ts`, the editor's own wiring is in its spec.
    interface TextAdsInternals {
      biddingDrafts: { set(v: Record<string, unknown>): void };
      onLinkedInFormatChange(format: string): void;
      onLinkedInTextAdsChange(ads: { key: string; headline: string; description: string }[]): void;
    }
    const textAds = (f: ComponentFixture<ImplementationTabComponent>): TextAdsInternals => f.componentInstance as unknown as TextAdsInternals;
    const textAd = { key: 'text-ad-1', headline: 'KubeCon EU', description: 'Join cloud native engineers.' };

    it('offers Text Ads only on an explicit yes, and sends them with a manual bid in place of the variants', async () => {
      const { fixture: f, latest } = await mount(null);
      expect(q(f, 'implementation-linkedin-format')).toBeNull();

      f.componentRef.setInput('linkedInTextAdsEnabled', true);
      f.componentRef.setInput('biddingEnabled', true);
      textAds(f).biddingDrafts.set({ 'linkedin-ads': { strategy: 'manual', bidAmount: 5 } });
      textAds(f).onLinkedInFormatChange('text');
      textAds(f).onLinkedInTextAdsChange([textAd]);
      f.detectChanges();
      expect(q(f, 'implementation-linkedin-text-ads')).not.toBeNull();
      expect(q(f, 'implementation-linkedin-variants')).toBeNull();
      expect(latest()).toMatchObject({ linkedInFormat: 'text', linkedInTextAds: [textAd] });

      fillForm(f);
      at(f).submit();
      expect(createCampaign.mock.calls[0][0]['linkedInConfig']).toMatchObject({
        format: 'text',
        textAds: [{ headline: 'KubeCon EU', description: 'Join cloud native engineers.' }],
        variants: [],
      });
    });

    it('holds Create while Text Ads have no manual bid', STATE_ONLY, async () => {
      const f = (await mount(null)).fixture;
      f.componentRef.setInput('linkedInTextAdsEnabled', true);
      f.componentRef.setInput('biddingEnabled', true);
      fillForm(f);
      textAds(f).onLinkedInFormatChange('text');
      textAds(f).onLinkedInTextAdsChange([textAd]);

      expect(at(f).createBlockedReason()).toBe('LinkedIn Ads: Text Ads need a manual bid. Choose manual bidding and set a maximum cost per click.');
      textAds(f).biddingDrafts.set({ 'linkedin-ads': { strategy: 'manual', bidAmount: 5 } });
      expect(at(f).createBlockedReason()).toBeNull();
    });

    it('holds Create, never sending single image ads instead, when a Text Ads choice is no longer offered', STATE_ONLY, async () => {
      const f = (await mount(null)).fixture;
      f.componentRef.setInput('linkedInTextAdsEnabled', true);
      fillForm(f);
      textAds(f).onLinkedInFormatChange('text');
      f.componentRef.setInput('linkedInTextAdsEnabled', false);

      expect(at(f).createBlockedReason()).toBe('LinkedIn Ads: Text Ads are not available right now. Choose single image ads as the ad format.');
      textAds(f).onLinkedInFormatChange('single_image');
      expect(at(f).createBlockedReason()).toBeNull();
    });

    it('holds Create, with the reason under the field, while two ads share a name', async () => {
      const f = (await mount(null)).fixture;
      f.componentRef.setInput('linkedInVariantCopyEnabled', true);
      fillForm(f);
      type(f, 'implementation-linkedin-variant-name-0', 'Same name');
      type(f, 'implementation-linkedin-variant-name-1', 'Same name');

      expect(at(f).createBlockedReason()).toBe('LinkedIn Ads: fix the ad name or description.');
      expect(q(f, 'implementation-linkedin-variant-name-1')?.textContent).toContain('Ad 1 already has this name.');
      type(f, 'implementation-linkedin-variant-name-1', 'Other name');
      expect(at(f).createBlockedReason()).not.toBe('LinkedIn Ads: fix the ad name or description.');
    });

    it("holds Create while a name equals another ad's default, built from the stored brief's event name", async () => {
      const f = (await mount(null)).fixture;
      f.componentRef.setInput('linkedInVariantCopyEnabled', true);
      fillForm(f);
      // The brief's event is "KubeCon EU 2026"; ad 2 is left unnamed, so campaign-service names it "KubeCon EU 2026 | variant-2".
      type(f, 'implementation-linkedin-variant-name-0', 'KubeCon EU 2026 | variant-2');

      expect(at(f).createBlockedReason()).toBe('LinkedIn Ads: fix the ad name or description.');
    });

    it('sends the intro text and headline as edited, on that variant only', async () => {
      const f = (await mount(null)).fixture;
      type(f, 'implementation-linkedin-variant-intro-1', 'A new intro');
      type(f, 'implementation-linkedin-variant-headline-1', 'A new headline');

      expect(submitVariants(f)).toEqual([
        { introText: 'First intro', headline: 'First headline' },
        { introText: 'A new intro', headline: 'A new headline', imageUrn: 'urn:li:image:C4D10AQ' },
      ]);
    });

    it('carries the edits in the draft, and a remount restores them over the brief copy', async () => {
      const first = await mount(null);
      type(first.fixture, 'implementation-linkedin-variant-headline-0', 'Edited headline');
      const draft = { ...(first.latest() as CampaignImplementationDraft), eventSlug: 'kubecon-eu-2026' };
      expect(draft.linkedInVariants?.map((v) => v.headline)).toEqual(['Edited headline', 'Second headline']);
      first.fixture.destroy();

      const second = (await mount(null, draft)).fixture;
      expect(submitVariants(second).map((v) => v['headline'])).toEqual(['Edited headline', 'Second headline']);
    });

    it('counts the characters and blocks Create, with the reason under the field, while the intro text is over 600', async () => {
      const f = (await mount(null)).fixture;
      fillForm(f);
      expect(at(f).canSubmit()).toBe(true);

      type(f, 'implementation-linkedin-variant-intro-0', 'a'.repeat(601));
      expect(q(f, 'implementation-linkedin-variant-intro-0')?.textContent).toContain("The intro text is 601 characters, over LinkedIn's 600. Shorten it.");
      expect(at(f).createBlockedReason()).toBe('LinkedIn Ads: fix the ad variant text.');

      type(f, 'implementation-linkedin-variant-intro-0', 'a'.repeat(600));
      expect(q(f, 'implementation-linkedin-variant-intro-0')?.textContent).toContain('600/600 characters');
      expect(at(f).canSubmit()).toBe(true);
    });

    it('adds an empty variant, which holds Create until its copy is written, and sends it', async () => {
      const f = (await mount(null)).fixture;
      fillForm(f);
      click(f, 'implementation-linkedin-variant-add');

      expect(at(f).linkedInVariants()).toHaveLength(3);
      expect(at(f).createBlockedReason()).toBe('LinkedIn Ads: fix the ad variant text.');
      type(f, 'implementation-linkedin-variant-intro-2', 'Third intro');
      type(f, 'implementation-linkedin-variant-headline-2', 'Third headline');
      expect(submitVariants(f)[2]).toEqual({ introText: 'Third intro', headline: 'Third headline' });
    });

    it('removes the chosen variant and sends the rest', async () => {
      const f = (await mount(null)).fixture;
      click(f, 'implementation-linkedin-variant-remove-0');

      expect(submitVariants(f)).toEqual([{ introText: 'Second intro', headline: 'Second headline', imageUrn: 'urn:li:image:C4D10AQ' }]);
    });

    it('keeps at least one variant: Remove is disabled on the last, and refused if reached anyway', async () => {
      const f = (await mount(null, null, brief([{ introText: 'Only intro', headline: 'Only headline' }]))).fixture;

      expect(buttonDisabled(f, 'implementation-linkedin-variant-remove-0')).toBe(true);
      at(f).removeLinkedInVariant(at(f).linkedInVariants()[0].key);
      expect(at(f).linkedInVariants()).toHaveLength(1);
    });

    it('offers at most 15 variants: Add is disabled at 15, and refused if reached anyway', async () => {
      const f = (await mount(null)).fixture;
      for (let i = 2; i < 15; i++) click(f, 'implementation-linkedin-variant-add');

      expect(at(f).linkedInVariants()).toHaveLength(15);
      expect(buttonDisabled(f, 'implementation-linkedin-variant-add')).toBe(true);
      at(f).addLinkedInVariant();
      expect(at(f).linkedInVariants()).toHaveLength(15);
    });
  });

  describe('images', () => {
    it.each([
      ['unanswered', null],
      ['off', false],
    ])('renders no upload while the LinkedIn upload capability is %s, and sends no image asset', async (_label, upload) => {
      const f = (await mount(upload)).fixture;

      expect(q(f, 'implementation-linkedin-variant-image-file-0')).toBeNull();
      expect(submitVariants(f).some((v) => 'imageAssetId' in v)).toBe(false);
    });

    it("uploads the chosen image for the saved brief and sends it on that variant only, in place of the variant's image URN", async () => {
      const f = (await mount(true)).fixture;
      const file = png();
      choose(f, file, 1);

      expect(uploadCreativeAsset).toHaveBeenCalledWith(file, 'tlf', BRIEF_ID, 'linkedin');
      expect(q(f, 'implementation-linkedin-variant-image-status-1')?.textContent).toContain('Uploaded: promo.png');
      expect(q(f, 'implementation-linkedin-variant-image-status-0')?.textContent?.trim()).toBe('');
      const variants = submitVariants(f);
      // The variant with no upload sends no image asset; campaign-service refuses a variant carrying both fields.
      expect(variants).toEqual([
        { introText: 'First intro', headline: 'First headline' },
        { introText: 'Second intro', headline: 'Second headline', imageAssetId: ASSET_ID },
      ]);
    });

    it('does not hold a Text Ads create over a variant image upload still running (#5764 row 19)', async () => {
      uploadCreativeAsset.mockReturnValue(new Subject<unknown>());
      const f = (await mount(true)).fixture;
      fillForm(f);
      choose(f, png());
      expect(at(f).createBlockedReason()).toBe('Waiting for the LinkedIn Ads image upload to finish.');

      const c = f.componentInstance as unknown as {
        biddingDrafts: { set(v: Record<string, unknown>): void };
        onLinkedInFormatChange(format: string): void;
        onLinkedInTextAdsChange(ads: { key: string; headline: string; description: string }[]): void;
      };
      f.componentRef.setInput('linkedInTextAdsEnabled', true);
      f.componentRef.setInput('biddingEnabled', true);
      c.biddingDrafts.set({ 'linkedin-ads': { strategy: 'manual', bidAmount: 5 } });
      c.onLinkedInFormatChange('text');
      c.onLinkedInTextAdsChange([{ key: 'text-ad-1', headline: 'KubeCon EU', description: 'Join cloud native engineers.' }]);
      expect(at(f).createBlockedReason()).toBeNull();
    });

    it('does not hold a Text Ads create over a variant image it does not send (#5764 row 19)', async () => {
      const f = (await mount(true)).fixture;
      fillForm(f);
      choose(f, png(5_000_001));
      expect(at(f).createBlockedReason()).toBe('LinkedIn Ads: resolve the image notice.');

      const c = f.componentInstance as unknown as {
        biddingDrafts: { set(v: Record<string, unknown>): void };
        onLinkedInFormatChange(format: string): void;
        onLinkedInTextAdsChange(ads: { key: string; headline: string; description: string }[]): void;
      };
      f.componentRef.setInput('linkedInTextAdsEnabled', true);
      f.componentRef.setInput('biddingEnabled', true);
      c.biddingDrafts.set({ 'linkedin-ads': { strategy: 'manual', bidAmount: 5 } });
      c.onLinkedInFormatChange('text');
      c.onLinkedInTextAdsChange([{ key: 'text-ad-1', headline: 'KubeCon EU', description: 'Join cloud native engineers.' }]);
      expect(at(f).createBlockedReason()).toBeNull();
    });

    // A text ad's image (#5764 row 19): the size and file rules are rows in `campaign-linkedin-text-ads-form.utils.spec.ts`,
    // and the picker's wiring is in the editor's spec. These check the pick reaches the upload and the create.
    async function textAdsWithImage(size: { width: number; height: number }): Promise<ComponentFixture<ImplementationTabComponent>> {
      const f = (await mount(true)).fixture;
      const c = f.componentInstance as unknown as {
        biddingDrafts: { set(v: Record<string, unknown>): void };
        onLinkedInFormatChange(format: string): void;
        onLinkedInTextAdsChange(ads: { key: string; headline: string; description: string }[]): void;
        onLinkedInTextAdImageFileChange(pick: { key: string; event: Event }): void;
        readImageSize(file: Blob): Promise<{ width: number; height: number } | null>;
      };
      vi.spyOn(c, 'readImageSize').mockResolvedValue(size);
      f.componentRef.setInput('linkedInTextAdsEnabled', true);
      f.componentRef.setInput('biddingEnabled', true);
      c.biddingDrafts.set({ 'linkedin-ads': { strategy: 'manual', bidAmount: 5 } });
      c.onLinkedInFormatChange('text');
      c.onLinkedInTextAdsChange([{ key: 'text-ad-1', headline: 'KubeCon EU', description: 'Join cloud native engineers.' }]);
      fillForm(f);
      c.onLinkedInTextAdImageFileChange({ key: 'text-ad-1', event: { target: { files: [png()], value: '' } } as unknown as Event });
      // The size read settles on a later microtask.
      await new Promise((resolve) => setTimeout(resolve));
      return f;
    }

    it('uploads a 100x100 text ad image for the saved brief and sends it on that text ad', STATE_ONLY, async () => {
      const f = await textAdsWithImage({ width: 100, height: 100 });

      expect(uploadCreativeAsset).toHaveBeenCalledWith(expect.any(File), 'tlf', BRIEF_ID, 'linkedin');
      at(f).submit();
      expect(createCampaign.mock.calls[0][0]['linkedInConfig']).toMatchObject({
        format: 'text',
        textAds: [{ headline: 'KubeCon EU', description: 'Join cloud native engineers.', imageAssetId: ASSET_ID }],
      });
    });

    it('never uploads a text ad image that is not 100x100, and holds Create until it is removed', STATE_ONLY, async () => {
      const f = await textAdsWithImage({ width: 120, height: 120 });

      expect(uploadCreativeAsset).not.toHaveBeenCalled();
      expect(at(f).createBlockedReason()).toBe('LinkedIn Ads: resolve the image notice.');
      (f.componentInstance as unknown as { onLinkedInTextAdImageRemove(key: string): void }).onLinkedInTextAdImageRemove('text-ad-1');
      expect(at(f).createBlockedReason()).toBeNull();
    });

    it('drops a text ad image upload in flight when its text ad is removed, and no other', STATE_ONLY, async () => {
      uploadCreativeAsset.mockReturnValue(new Subject<unknown>());
      const f = await textAdsWithImage({ width: 100, height: 100 });
      const c = f.componentInstance as unknown as { onLinkedInTextAdsChange(ads: { key: string; headline: string; description: string }[]): void };
      const kept = { key: 'text-ad-1', headline: 'KubeCon EU', description: 'Join cloud native engineers.' };
      const other = { key: 'text-ad-2', headline: 'KubeCon NA', description: 'Meet the maintainers.' };
      expect(at(f).createBlockedReason()).toBe('Waiting for the LinkedIn Ads image upload to finish.');

      c.onLinkedInTextAdsChange([kept, other]);
      c.onLinkedInTextAdsChange([kept]);
      expect(at(f).createBlockedReason()).toBe('Waiting for the LinkedIn Ads image upload to finish.');

      c.onLinkedInTextAdsChange([other]);
      expect(at(f).createBlockedReason()).not.toBe('Waiting for the LinkedIn Ads image upload to finish.');
    });

    it('lets a variant take a pick after switching back from Text Ads with a failed text ad image', STATE_ONLY, async () => {
      const f = await textAdsWithImage({ width: 120, height: 120 });
      const c = f.componentInstance as unknown as {
        linkedInVariants(): { key: string }[];
        onLinkedInFormatChange(format: string): void;
        onLinkedInVariantImageFileChange(key: string, event: Event): void;
      };
      c.onLinkedInFormatChange('single_image');
      const file = png();
      c.onLinkedInVariantImageFileChange(c.linkedInVariants()[0].key, { target: { files: [file], value: '' } } as unknown as Event);

      expect(uploadCreativeAsset).toHaveBeenCalledWith(file, 'tlf', BRIEF_ID, 'linkedin');
    });

    it.each([
      ['an oversized image', () => png(5_000_001)],
      ['a file that is not a PNG or JPEG', () => new File([new Uint8Array(4)], 'promo.gif', { type: 'image/gif' })],
    ])('blocks Create after %s replaces an uploaded one, and keeps the reason across a tab switch', async (_label, file) => {
      const first = await mount(true);
      fillForm(first.fixture);
      choose(first.fixture, png());
      choose(first.fixture, file());

      expect(q(first.fixture, 'implementation-linkedin-variant-image-asset-block-uploadFailed-0')).not.toBeNull();
      expect(at(first.fixture).canSubmit()).toBe(false);
      const draft = { ...(first.latest() as CampaignImplementationDraft), eventSlug: 'kubecon-eu-2026' };
      expect(draft.linkedInImageUploadFailedBriefId).toBe(BRIEF_ID);
      first.fixture.destroy();

      const second = (await mount(true, draft)).fixture;
      fillForm(second);
      expect(q(second, 'implementation-linkedin-variant-image-asset-block-uploadFailed-0')).not.toBeNull();
      expect(at(second).canSubmit()).toBe(false);
    });

    it('suggests removing the image, not pasting a URL, when the image service is unavailable', async () => {
      uploadCreativeAsset.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
      const f = (await mount(true)).fixture;
      choose(f, png());

      expect(at(f).linkedInImageUploadError()).toBe(
        'The image service is unavailable right now. Try again in a moment, or remove the image to continue without it.'
      );
    });

    // One row proves the brief's save state reaches the picker; the rest are rows in `campaign-linkedin-image.utils.spec.ts` (#5980).
    it('disables every picker while the brief is saving', async () => {
      const f = (await mount(true)).fixture;
      f.componentRef.setInput('briefPersistence', { status: 'saving', briefId: '6f9619ff-8b86-d011-b42d-00c04fc964ff', message: null, approved: true });
      f.detectChanges();

      expect((q(f, 'implementation-linkedin-variant-image-file-0') as HTMLInputElement).disabled).toBe(true);
      expect((q(f, 'implementation-linkedin-variant-image-file-1') as HTMLInputElement).disabled).toBe(true);
    });

    it("holds Create and the other variants' pickers while an upload is in flight, and Cancel aborts it", async () => {
      uploadCreativeAsset.mockReturnValue(new Subject<unknown>());
      const f = (await mount(true)).fixture;
      fillForm(f);
      expect(at(f).canSubmit()).toBe(true);

      choose(f, png(), 0);
      expect(at(f).linkedInImageUploadStatus()).toBe('uploading');
      expect(at(f).canSubmit()).toBe(false);
      // A second LinkedIn upload would cancel this one (`uploadCreativeAsset` keeps one per owner).
      expect((q(f, 'implementation-linkedin-variant-image-file-1') as HTMLInputElement).disabled).toBe(true);
      expect(q(f, 'implementation-linkedin-variant-image-upload-1')?.textContent).toContain('Finish or remove the image for variant 1 first.');

      click(f, 'implementation-linkedin-variant-image-cancel-0');
      expect(cancelCreativeAssetUpload).toHaveBeenCalledWith('linkedin');
      expect(at(f).linkedInImageUploadStatus()).toBe('idle');
      expect((q(f, 'implementation-linkedin-variant-image-file-1') as HTMLInputElement).disabled).toBe(false);
      expect(at(f).canSubmit()).toBe(true);
    });

    it("never starts a second upload over another variant's upload in flight, even if its picker fires", async () => {
      uploadCreativeAsset.mockReturnValue(new Subject<unknown>());
      const f = (await mount(true)).fixture;
      choose(f, png(), 0);
      choose(f, png(16, 'second.png'), 1);

      expect(uploadCreativeAsset).toHaveBeenCalledTimes(1);
      expect(cancelCreativeAssetUpload).not.toHaveBeenCalled();
      expect(at(f).linkedInImageUploadStatus()).toBe('uploading');
    });

    it('cancels the upload of a variant that is removed while its image is in flight', async () => {
      uploadCreativeAsset.mockReturnValue(new Subject<unknown>());
      const f = (await mount(true)).fixture;
      choose(f, png(), 1);
      click(f, 'implementation-linkedin-variant-remove-1');

      expect(cancelCreativeAssetUpload).toHaveBeenCalledWith('linkedin');
      expect(at(f).linkedInImageUploadStatus()).toBe('idle');
    });

    it('carries the upload in the draft, and a remount resumes an upload still in flight onto its variant', async () => {
      const pending = new Subject<unknown>();
      uploadCreativeAsset.mockReturnValue(pending);
      const first = await mount(true);
      choose(first.fixture, png(), 1);
      const draft = first.latest() as CampaignImplementationDraft;
      expect(draft.linkedInImageUploadPendingName).toBe('promo.png');
      expect(draft.linkedInImageUploadPendingBriefId).toBe(BRIEF_ID);
      expect(draft.linkedInImageUploadVariantKey).toBe(draft.linkedInVariants?.[1].key);
      first.fixture.destroy();

      resumeCreativeAssetUpload.mockReturnValue(pending);
      const second = await mount(true, { ...draft, eventSlug: 'kubecon-eu-2026' });
      expect(resumeCreativeAssetUpload).toHaveBeenCalledWith('linkedin', BRIEF_ID);
      pending.next({ id: ASSET_ID, mimeType: 'image/png', byteSize: 16, checksum: 'ab'.repeat(32), created: true });
      second.fixture.detectChanges();
      expect(
        at(second.fixture)
          .linkedInVariants()
          .map((v) => v.imageAssetId)
      ).toEqual(['', ASSET_ID]);
      expect(second.latest()?.linkedInVariants?.[1].imageAssetId).toBe(ASSET_ID);
    });

    it.each([
      ['off', false, 'ready', 'unsupported'],
      // Pending proves `createCapabilityRead` reaches the rule; the other kinds are rows in `campaign-linkedin-image.utils.spec.ts` (#5980).
      ['unanswered, with the read pending', null, 'pending', 'pending'],
    ] as const)('blocks Create for a restored upload while the capability is %s, until it is removed', async (_label, upload, read, kind) => {
      const draft = await uploadedDraft();
      const f = (await mount(upload, draft)).fixture;
      f.componentRef.setInput('createCapabilityRead', read);
      fillForm(f);

      expect(q(f, `implementation-linkedin-variant-image-asset-block-${kind}-0`)).not.toBeNull();
      expect(at(f).canSubmit()).toBe(false);

      click(f, 'implementation-linkedin-variant-image-asset-block-remove-0');
      expect(q(f, `implementation-linkedin-variant-image-asset-block-${kind}-0`)).toBeNull();
      expect(at(f).canSubmit()).toBe(true);
      expect(submitVariants(f).some((v) => 'imageAssetId' in v)).toBe(false);
    });

    it('keeps an upload running through a re-seed when the parent restores its draft, and lands it on its variant', async () => {
      const pending = new Subject<unknown>();
      uploadCreativeAsset.mockReturnValue(pending);
      const mounted = await mount(true);
      const f = mounted.fixture;
      fillForm(f);
      choose(f, png(), 1);

      // The service still holds the upload (nothing cancelled it), so the draft restore resumes it.
      resumeCreativeAssetUpload.mockReturnValue(pending);
      // As the parent does on a refine: it holds the emitted draft and hands the tab a new brief.
      f.componentRef.setInput('draft', mounted.latest());
      f.componentRef.setInput('briefData', brief());
      f.detectChanges();
      await f.whenStable();
      f.detectChanges();

      expect(cancelCreativeAssetUpload).not.toHaveBeenCalled();
      expect(at(f).linkedInImageUploadStatus()).toBe('uploading');
      expect(at(f).linkedInImageUploadError()).toBe('');

      pending.next({ id: ASSET_ID, mimeType: 'image/png', byteSize: 16, checksum: 'ab'.repeat(32), created: true });
      pending.complete();
      f.detectChanges();
      expect(at(f).linkedInImageUploadStatus()).toBe('idle');
      expect(submitVariants(f).map((variant) => variant['imageAssetId'])).toEqual([undefined, ASSET_ID]);
    });

    it('frees the upload slot when an upload fails after the brief re-seeded its variant away', async () => {
      const pending = new Subject<unknown>();
      uploadCreativeAsset.mockReturnValue(pending);
      const f = (await mount(true)).fixture;
      fillForm(f);
      choose(f, png(), 1);
      expect(at(f).linkedInImageUploadStatus()).toBe('uploading');

      // A refine hands the tab a new brief for the same saved id: the variants get fresh keys.
      f.componentRef.setInput('briefData', brief());
      f.detectChanges();
      await f.whenStable();
      f.detectChanges();
      pending.error(new HttpErrorResponse({ status: 400, error: { message: 'the image is truncated' } }));
      f.detectChanges();

      expect(at(f).linkedInImageUploadStatus()).toBe('idle');
      expect(at(f).linkedInImageUploadError()).toBe('');
      expect((q(f, 'implementation-linkedin-variant-image-file-0') as HTMLInputElement).disabled).toBe(false);
      expect((q(f, 'implementation-linkedin-variant-image-file-1') as HTMLInputElement).disabled).toBe(false);
      expect(at(f).canSubmit()).toBe(true);
    });

    it('keeps Create blocked after a failed upload, on its variant only, and the other pickers held, until the operator removes it', async () => {
      uploadCreativeAsset.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 400, error: { message: 'the image is truncated' } })));
      const f = (await mount(true)).fixture;
      fillForm(f);
      choose(f, png(), 1);

      expect(at(f).linkedInImageUploadStatus()).toBe('error');
      expect(q(f, 'implementation-linkedin-variant-image-asset-block-uploadFailed-1')?.textContent).toContain('LinkedIn variant 2');
      expect(q(f, 'implementation-linkedin-variant-image-asset-block-uploadFailed-0')).toBeNull();
      expect(at(f).canSubmit()).toBe(false);
      expect((q(f, 'implementation-linkedin-variant-image-file-0') as HTMLInputElement).disabled).toBe(true);

      click(f, 'implementation-linkedin-variant-image-asset-block-remove-1');
      expect(q(f, 'implementation-linkedin-variant-image-asset-block-uploadFailed-1')).toBeNull();
      expect(at(f).canSubmit()).toBe(true);
      expect((q(f, 'implementation-linkedin-variant-image-file-0') as HTMLInputElement).disabled).toBe(false);
    });
  });

  // Video ads (#5764 row 18): the file and payload rules are rows in `campaign-linkedin-video-form.utils.spec.ts`; these
  // keep the wiring.
  describe('videos', () => {
    const VIDEO_ID = '9a7b1c2d-3e4f-4a6b-8c1e-5d4a3f2b4e6f';
    const mp4 = (size = 100 * 1024, name = 'promo.mp4'): File => new File([new Uint8Array(size)], name, { type: 'video/mp4' });
    interface VideoInternals {
      onLinkedInFormatChange(format: string): void;
      onLinkedInVariantVideoFileChange(key: string, event: Event): void;
    }
    const video = (f: ComponentFixture<ImplementationTabComponent>): VideoInternals => f.componentInstance as unknown as VideoInternals;
    const pick = (f: ComponentFixture<ImplementationTabComponent>, index: number, file: File): void =>
      video(f).onLinkedInVariantVideoFileChange(at(f).linkedInVariants()[index].key, { target: { files: [file], value: '' } } as unknown as Event);

    async function mountVideo(): Promise<ComponentFixture<ImplementationTabComponent>> {
      const f = (await mount(true)).fixture;
      f.componentRef.setInput('linkedInVideoAdsEnabled', true);
      f.componentRef.setInput('linkedInVariantCopyEnabled', true);
      fillForm(f);
      video(f).onLinkedInFormatChange('video');
      return f;
    }

    it('offers video ads only on an explicit yes, with a video picker in place of the image and no description', async () => {
      const f = (await mount(true)).fixture;
      f.componentRef.setInput('linkedInVariantCopyEnabled', true);
      f.detectChanges();
      expect(q(f, 'implementation-linkedin-format')).toBeNull();

      f.componentRef.setInput('linkedInVideoAdsEnabled', true);
      video(f).onLinkedInFormatChange('video');
      f.detectChanges();
      expect(q(f, 'implementation-linkedin-format')).not.toBeNull();
      expect(q(f, 'implementation-linkedin-variant-video-file-0')?.getAttribute('accept')).toBe('video/mp4');
      expect(q(f, 'implementation-linkedin-variant-image-file-0')).toBeNull();
      expect(q(f, 'implementation-linkedin-variant-description-0')).toBeNull();
    });

    it('uploads a video for each ad and sends it with no image or description, holding Create until every ad has one', STATE_ONLY, async () => {
      uploadCreativeAsset.mockReturnValue(of({ id: VIDEO_ID, mimeType: 'video/mp4', byteSize: 102_400, checksum: 'ab'.repeat(32), created: true }));
      const f = await mountVideo();
      at(f).onLinkedInVariantTextChange(at(f).linkedInVariants()[0].key, 'description', 'Two days of talks');

      pick(f, 0, mp4());
      expect(uploadCreativeAsset).toHaveBeenCalledWith(expect.any(File), 'tlf', BRIEF_ID, 'linkedin');
      expect(at(f).createBlockedReason()).toBe('LinkedIn Ads: upload a video for every ad.');

      pick(f, 1, mp4());
      expect(at(f).createBlockedReason()).toBeNull();
      at(f).submit();
      expect((createCampaign.mock.calls[0][0]['linkedInConfig'] as { variants: unknown[] }).variants).toEqual([
        { introText: 'First intro', headline: 'First headline', videoAssetId: VIDEO_ID },
        { introText: 'Second intro', headline: 'Second headline', videoAssetId: VIDEO_ID },
      ]);
    });

    it('refuses a file that is not an MP4 before uploading it', STATE_ONLY, async () => {
      const f = await mountVideo();

      pick(f, 0, png());

      expect(uploadCreativeAsset).not.toHaveBeenCalled();
      expect(at(f).linkedInImageUploadError()).toBe('Only MP4 videos can be uploaded.');
    });

    it("clears the variant's video, not its image, from the notice's Remove", STATE_ONLY, async () => {
      // A video made for another brief, as a restored draft can hold.
      uploadCreativeAsset.mockReturnValue(of({ id: VIDEO_ID, mimeType: 'video/mp4', byteSize: 102_400, checksum: 'ab'.repeat(32), created: true }));
      const f = await mountVideo();
      pick(f, 0, mp4());
      pick(f, 1, mp4());
      const c = f.componentInstance as unknown as {
        linkedInVariants: { update(fn: (v: Record<string, unknown>[]) => Record<string, unknown>[]): void };
        linkedInVariantViews(): { imageBlock: { kind: string } | null }[];
        onLinkedInVariantMediaRemove(key: string): void;
      };
      c.linkedInVariants.update((variants) =>
        variants.map((v, i) => (i === 0 ? { ...v, imageAssetId: 'img', imageAssetBriefId: BRIEF_ID, videoAssetBriefId: 'another-brief' } : v))
      );
      expect(c.linkedInVariantViews()[0].imageBlock?.kind).toBe('otherBrief');

      c.onLinkedInVariantMediaRemove(at(f).linkedInVariants()[0].key);
      expect(c.linkedInVariantViews()[0].imageBlock).toBeNull();
      expect(at(f).linkedInVariants()[0]).toMatchObject({ imageAssetId: 'img', videoAssetId: '' });
    });

    // A stored video is not in the library (#5764 row 18), so one no ad uses any more is deleted to free the brief's quota.
    describe('stored videos', () => {
      const NEW_ID = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
      const storedVideo = (id: string) => of({ id, mimeType: 'video/mp4', byteSize: 102_400, checksum: 'ab'.repeat(32), created: true });
      const removeVideo = (f: ComponentFixture<ImplementationTabComponent>, index: number): void =>
        (f.componentInstance as unknown as { onLinkedInVariantVideoRemove(key: string): void }).onLinkedInVariantVideoRemove(
          at(f).linkedInVariants()[index].key
        );

      beforeEach(() => deleteCreativeAsset.mockClear());

      it('deletes a removed video once no other ad uses it', STATE_ONLY, async () => {
        uploadCreativeAsset.mockReturnValue(storedVideo(VIDEO_ID));
        const f = await mountVideo();
        pick(f, 0, mp4());
        pick(f, 1, mp4());

        removeVideo(f, 0);
        expect(deleteCreativeAsset).not.toHaveBeenCalled();
        removeVideo(f, 1);
        expect(deleteCreativeAsset).toHaveBeenCalledWith('tlf', BRIEF_ID, VIDEO_ID);
      });

      it('deletes a replaced video once the new one is stored, but not when the same video comes back', STATE_ONLY, async () => {
        uploadCreativeAsset.mockReturnValue(storedVideo(VIDEO_ID));
        const f = await mountVideo();
        pick(f, 0, mp4());
        pick(f, 0, mp4());
        expect(deleteCreativeAsset).not.toHaveBeenCalled();

        uploadCreativeAsset.mockReturnValue(storedVideo(NEW_ID));
        pick(f, 0, mp4());
        expect(deleteCreativeAsset).toHaveBeenCalledWith('tlf', BRIEF_ID, VIDEO_ID);
      });

      it('leaves a video campaign-service refuses to delete, without an error on the tab', STATE_ONLY, async () => {
        deleteCreativeAsset.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 409 })));
        uploadCreativeAsset.mockReturnValue(storedVideo(VIDEO_ID));
        const f = await mountVideo();
        pick(f, 0, mp4());

        removeVideo(f, 0);
        expect(deleteCreativeAsset).toHaveBeenCalledTimes(1);
        expect(at(f).linkedInImageUploadError()).toBe('');
      });
    });

    it('holds Create, never sending image ads instead, when a video choice is no longer offered', STATE_ONLY, async () => {
      const f = await mountVideo();
      f.componentRef.setInput('linkedInVideoAdsEnabled', false);

      expect(at(f).createBlockedReason()).toBe('LinkedIn Ads: video ads are not available right now. Choose single image ads as the ad format.');
      video(f).onLinkedInFormatChange('single_image');
      expect(at(f).createBlockedReason()).toBeNull();
    });
  });
});
