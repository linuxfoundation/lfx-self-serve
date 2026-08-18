// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { CampaignBriefOutput, CampaignImplementationDraft, CampaignBriefPersistenceState } from '@lfx-one/shared/interfaces';
import { ProjectContextService } from '@services/project-context.service';
import { MessageService } from 'primeng/api';
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
 * The tab round-trip, which is where per-platform budgets used to die (LFXV2-3315).
 *
 * `ImplementationTabComponent` sits inside the parent's structural `@switch`, so every visit to
 * another tab DESTROYS it and every signal it owns. The Google budget survived because it lives on
 * `campaignForm` and was carried on `CampaignImplementationDraft`; the per-platform budgets lived
 * only in component-local signals and were not, so coming back re-seeded them to 500. An operator
 * who set LinkedIn to 2500, checked Insights, and came back would see 500 — and `submit()` reads
 * the signal, so they could launch spend at a number they never approved and never saw.
 *
 * Simulated the way the parent actually does it: emit a draft from one component, then hand it to
 * a SECOND, freshly created one. Mutating a single fixture would prove nothing, because the whole
 * defect is that the first instance's state is gone.
 */
describe('ImplementationTabComponent budget round-trip across a tab switch', () => {
  /** Matches the slug on the brief below — `applyDraft` ignores a draft keyed to another event. */
  const EVENT_SLUG = 'kubecon-eu-2026';

  const brief = (): CampaignBriefOutput =>
    ({
      eventDetails: { name: 'KubeCon EU 2026', slug: EVENT_SLUG, countryCode: 'US', registrationUrl: 'https://example.com/kubecon' },
      totalBudget: 500,
      selectedPlatforms: ['google-ads', 'linkedin-ads', 'meta-ads', 'reddit-ads'],
      structuredCopy: { google_search: { headlines: ['Attend KubeCon'], descriptions: ['Join us in September'] } },
    }) as unknown as CampaignBriefOutput;

  /** The platform budget signals are protected; reach them the way the sibling specs do. */
  interface BudgetInternals {
    linkedInBudgetUsd: { (): number; set(v: number): void };
    linkedInLifetimeBudget: { (): boolean; set(v: boolean): void };
    redditBudgetUsd: { (): number; set(v: number): void };
    metaBudgetUsd: { (): number; set(v: number): void };
    metaLifetimeBudget: { (): boolean; set(v: boolean): void };
  }
  const budgets = (f: ComponentFixture<ImplementationTabComponent>): BudgetInternals => f.componentInstance as unknown as BudgetInternals;

  /** Type the form reach once — several tests below drive an edit to force a re-emission. */
  interface FormInternals {
    campaignForm: { controls: Record<string, { setValue(v: unknown): void }> };
  }
  const setEventName = (f: ComponentFixture<ImplementationTabComponent>, value: string): void =>
    (f.componentInstance as unknown as FormInternals).campaignForm.controls['eventName'].setValue(value);

  /** Mount a component on the brief, exactly as the parent does when Implement opens. */
  async function mount(draft: CampaignImplementationDraft | null): Promise<ComponentFixture<ImplementationTabComponent>> {
    const f = TestBed.createComponent(ImplementationTabComponent);
    if (draft) f.componentRef.setInput('draft', draft);
    f.componentRef.setInput('briefData', brief());
    f.detectChanges();
    await f.whenStable();
    return f;
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
   * Drives each bound control through the DOM, one per test case.
   *
   * The sibling test calls the handlers directly, which pins only the handler body. That left
   * five of the six `emitDraft()` calls able to be deleted with the whole suite still green —
   * including three bound to real money controls. A DOM-driven edit is the only shape that
   * proves the binding, the handler AND the emission all work together.
   *
   * No `detectChanges()` between the edit and the assertion: it re-runs the brief effect, whose
   * trailing `emitDraft()` re-snapshots the already-updated signal and masks a missing emit.
   */
  it.each([
    {
      name: 'linkedin budget',
      selector: 'input[data-testid="implementation-linkedin-budget"]',
      kind: 'input' as const,
      value: '2500',
      read: (d: CampaignImplementationDraft) => d.linkedInBudgetUsd,
      want: 2500,
    },
    {
      name: 'linkedin lifetime',
      selector: 'input[data-testid="implementation-linkedin-lifetime-budget"]',
      kind: 'check' as const,
      value: '',
      read: (d: CampaignImplementationDraft) => d.linkedInLifetimeBudget,
      want: true,
    },
    {
      name: 'meta budget',
      selector: 'input[data-testid="implementation-meta-budget"]',
      kind: 'input' as const,
      value: '3200',
      read: (d: CampaignImplementationDraft) => d.metaBudgetUsd,
      want: 3200,
    },
    {
      name: 'meta lifetime',
      selector: 'input[data-testid="implementation-meta-lifetime-budget"]',
      kind: 'check' as const,
      value: '',
      read: (d: CampaignImplementationDraft) => d.metaLifetimeBudget,
      want: true,
    },
  ])('emits the draft when $name is edited through the DOM', async ({ selector, kind, value, read, want }) => {
    const f = await mount(null);
    const emitted: (CampaignImplementationDraft | null)[] = [null];
    f.componentInstance.draftChange.subscribe((d) => (emitted[0] = d));

    const el = (f.nativeElement as HTMLElement).querySelector(selector) as HTMLInputElement | null;
    expect(el, `no control matched ${selector} — the binding or the test id moved`).not.toBeNull();

    if (kind === 'check') {
      el!.checked = true;
      el!.dispatchEvent(new Event('change'));
    } else {
      el!.value = value;
      el!.dispatchEvent(new Event('input'));
    }

    expect(emitted[0], 'editing the control emitted no draft — the handler does not call emitDraft()').not.toBeNull();
    expect(read(emitted[0]!)).toBe(want);
  });

  it('carries every per-platform budget through emit and restore', async () => {
    const first = await mount(null);

    // Capture what the parent holds. `draftChange` fires on every edit, so the LAST emission is
    // the parent's copy at the moment the tab is torn down.
    // Captured in a one-slot array rather than a plain `let`: TypeScript does not track writes
    // made inside a subscribe callback, so a `let` narrows to `never` at every later read.
    const emitted: (CampaignImplementationDraft | null)[] = [null];
    first.componentInstance.draftChange.subscribe((d) => (emitted[0] = d));

    // A non-default value for each platform, all different, so a restore that mixed two fields up
    // could not pass by coincidence.
    budgets(first).linkedInBudgetUsd.set(2500);
    budgets(first).linkedInLifetimeBudget.set(true);
    budgets(first).redditBudgetUsd.set(1750);
    budgets(first).metaBudgetUsd.set(3200);
    budgets(first).metaLifetimeBudget.set(true);

    // Force the snapshot the way a user's typing would: any form edit re-emits the whole draft,
    // including the platform signals read above.
    setEventName(first, 'KubeCon EU 2026 - edited');
    first.detectChanges();
    await first.whenStable();

    const carried = emitted[0];
    expect(carried).not.toBeNull();
    expect(carried?.linkedInBudgetUsd).toBe(2500);
    expect(carried?.metaBudgetUsd).toBe(3200);

    // The tab switch. The first component is gone; only the draft survives.
    first.destroy();

    const second = await mount(carried);

    expect(budgets(second).linkedInBudgetUsd()).toBe(2500);
    expect(budgets(second).linkedInLifetimeBudget()).toBe(true);
    expect(budgets(second).redditBudgetUsd()).toBe(1750);
    expect(budgets(second).metaBudgetUsd()).toBe(3200);
    expect(budgets(second).metaLifetimeBudget()).toBe(true);
  });

  /**
   * An explicitly-cleared budget, which is the case a nullish-coalescing restore gets wrong.
   *
   * `onMetaBudgetInput` coerces an emptied input to 0, so 0 is a value the user can actually
   * produce. A restore written as `draft.metaBudgetUsd || 500` — or an optional field guarded with
   * `??` — would treat it as "not set" and put 500 back, resurrecting a default over a deliberate
   * edit. `canSubmit` gates on `< 1`, so the honest 0 keeps Create disabled; a resurrected 500
   * would silently re-enable it.
   */
  it('preserves an explicitly-zeroed budget rather than restoring the default', async () => {
    const first = await mount(null);
    // Captured in a one-slot array rather than a plain `let`: TypeScript does not track writes
    // made inside a subscribe callback, so a `let` narrows to `never` at every later read.
    const emitted: (CampaignImplementationDraft | null)[] = [null];
    first.componentInstance.draftChange.subscribe((d) => (emitted[0] = d));

    budgets(first).metaBudgetUsd.set(0);
    budgets(first).linkedInBudgetUsd.set(0);
    setEventName(first, 'KubeCon EU 2026 - zeroed');
    first.detectChanges();
    await first.whenStable();

    const carried = emitted[0];
    expect(carried?.metaBudgetUsd).toBe(0);
    first.destroy();

    const second = await mount(carried);

    expect(budgets(second).metaBudgetUsd()).toBe(0);
    expect(budgets(second).linkedInBudgetUsd()).toBe(0);
  });

  /**
   * Editing ONLY a platform budget must still reach the parent.
   *
   * `emitDraft` is otherwise driven entirely by `campaignForm.valueChanges`, and these budgets are
   * signals rather than form controls — so before LFXV2-3315 a user who touched nothing but the
   * Meta budget produced no emission at all. Restoring the field would not have helped: the draft
   * the parent held was the pre-edit one, so the "restore" would faithfully replay the old number.
   */
  it('emits a draft when only a platform budget is edited', async () => {
    const f = await mount(null);
    // Captured in a one-slot array rather than a plain `let`: TypeScript does not track writes
    // made inside a subscribe callback, so a `let` narrows to `never` at every later read.
    const emitted: (CampaignImplementationDraft | null)[] = [null];
    f.componentInstance.draftChange.subscribe((d) => (emitted[0] = d));

    // Asserted on the emission ITSELF, with no `detectChanges()` between the edit and the read —
    // and that is the only shape of this test that can fail. Running change detection re-runs the
    // brief effect, whose trailing `emitDraft()` re-snapshots the (already updated) signal, so an
    // assertion made after a CD pass reads 4100 even when the handler emits nothing. Verified by
    // mutation: with the handler's `emitDraft()` removed, the `detectChanges()` version still
    // passed. Calling the handler directly is also what a real `(input)` binding does — the DOM
    // event fires the handler, it is not change detection that produces the emission.
    (f.componentInstance as unknown as { onMetaBudgetInput(e: Event): void }).onMetaBudgetInput({
      target: { valueAsNumber: 4100 },
    } as unknown as Event);

    const carried = emitted[0];
    expect(carried).not.toBeNull();
    expect(carried?.metaBudgetUsd).toBe(4100);
  });
});
