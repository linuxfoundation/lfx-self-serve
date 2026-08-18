// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { CampaignBriefOutput, CampaignBriefPersistenceState } from '@lfx-one/shared/interfaces';
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
 * A brief saved BEFORE a platform was disabled must not restore that platform.
 *
 * The Plan picker gates `disabled` at the tile, but a stored brief reaches `selectedPlatforms`
 * through `populateFromBrief`, which never consults the picker. Without a filter there, an older
 * Reddit brief still submits `redditConfig` on brief-derived values the user never saw — and the
 * now-disabled tile means they cannot deselect it either.
 */
describe('ImplementationTabComponent brief restore', () => {
  let fixture: ComponentFixture<ImplementationTabComponent>;

  function selectedPlatforms(): string[] {
    return [...(fixture.componentInstance as unknown as { selectedPlatforms(): Set<string> }).selectedPlatforms()];
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
    restore(['google-ads', 'reddit-ads']);

    expect(selectedPlatforms()).not.toContain('reddit-ads');
    // The enabled sibling must SURVIVE — a filter that dropped everything would pass a
    // not-toContain assertion on its own while silently discarding the user's real choice.
    expect(selectedPlatforms()).toContain('google-ads');
  });

  it('selects nothing for an all-disabled brief rather than substituting a default', () => {
    restore(['reddit-ads']);

    // NOT ['google-ads']. Retaining the default would open a Reddit-only brief as a Google
    // campaign, and submit() builds its request from this signal — the user would dispatch a
    // platform they never chose. Empty leaves canSubmit() blocking, which is the honest state.
    expect(selectedPlatforms()).toEqual([]);
  });
});
