// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { CampaignBriefPersistenceState } from '@lfx-one/shared/interfaces';
import { ProjectContextService } from '@services/project-context.service';
import { beforeEach, describe, expect, it } from 'vitest';

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
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([]), ProjectContextService],
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
 * Reddit's objective and its conversion pixel.
 *
 * Observed end-to-end on 2026-08-13: every Reddit create from this tab failed with
 * "conversion pixel ID is required for objective conversions", and no campaign was ever
 * created. The cause is a DEFAULT, not a validation gap — the campaign service resolves an
 * ABSENT objective to `conversions` (reddit/client.go's defaultRedditObjective), and that
 * objective then requires a pixel. This tab sent neither field, so the one combination it
 * could produce was the one that can never succeed.
 *
 * These pin both halves: the objective is always sent, and the impossible pair is refused
 * before a job exists rather than after a round trip.
 */
describe('ImplementationTabComponent reddit objective and pixel', () => {
  let fixture: ComponentFixture<ImplementationTabComponent>;

  function inst(): {
    canSubmit(): boolean;
    selectedPlatforms: { set(v: string[]): void };
    redditObjective: { set(v: string): void };
    redditConversionPixelId: { set(v: string): void };
    redditNeedsPixel(): boolean;
    campaignForm: { controls: Record<string, { setValue(v: unknown): void }> };
  } {
    return fixture.componentInstance as never;
  }

  /** Reddit only, so Google's own required fields cannot be what blocks the gate. */
  function redditOnlyValid(): void {
    const c = inst();
    c.selectedPlatforms.set(['reddit-ads']);
    c.campaignForm.controls['eventName'].setValue('KubeCon EU 2026');
    c.campaignForm.controls['registrationUrl'].setValue('https://events.example.com/kubecon-eu-2026');
    c.campaignForm.controls['startDate'].setValue('2026-09-01');
    c.campaignForm.controls['endDate'].setValue('2026-09-30');
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ImplementationTabComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([]), ProjectContextService],
    }).compileComponents();

    fixture = TestBed.createComponent(ImplementationTabComponent);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  /**
   * The default must not be the objective that cannot be created without extra input. This is
   * the regression that shipped: `conversions` by omission, with no way to supply a pixel.
   */
  it('does not default to an objective that requires a pixel', () => {
    redditOnlyValid();
    expect(inst().redditNeedsPixel()).toBe(false);
    expect(inst().canSubmit()).toBe(true);
  });

  it('blocks submit when conversions is chosen with no pixel', () => {
    redditOnlyValid();
    expect(inst().canSubmit()).toBe(true);

    inst().redditObjective.set('conversions');
    fixture.detectChanges();

    expect(inst().redditNeedsPixel()).toBe(true);
    expect(inst().canSubmit()).toBe(false);
  });

  it('allows submit once a pixel is supplied for conversions', () => {
    redditOnlyValid();
    inst().redditObjective.set('conversions');
    fixture.detectChanges();
    expect(inst().canSubmit()).toBe(false);

    inst().redditConversionPixelId.set('a2_abc123def456');
    fixture.detectChanges();

    expect(inst().redditNeedsPixel()).toBe(false);
    expect(inst().canSubmit()).toBe(true);
  });

  /**
   * Whitespace is not a pixel. Without a trim the gate would open on a space, and the create
   * would then fail at Reddit for the very reason the gate exists to prevent.
   */
  it('treats a whitespace-only pixel as absent', () => {
    redditOnlyValid();
    inst().redditObjective.set('conversions');
    inst().redditConversionPixelId.set('   ');
    fixture.detectChanges();

    expect(inst().redditNeedsPixel()).toBe(true);
    expect(inst().canSubmit()).toBe(false);
  });

  /**
   * The pixel is required ONLY for conversions. Switching away must clear the block rather
   * than stranding the user behind a field the objective no longer uses.
   */
  it('stops requiring a pixel when the objective changes away from conversions', () => {
    redditOnlyValid();
    inst().redditObjective.set('conversions');
    fixture.detectChanges();
    expect(inst().canSubmit()).toBe(false);

    inst().redditObjective.set('awareness');
    fixture.detectChanges();

    expect(inst().redditNeedsPixel()).toBe(false);
    expect(inst().canSubmit()).toBe(true);
  });
});
