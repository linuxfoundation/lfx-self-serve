// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AccountContextService } from '@services/account-context.service';
import { DataDogRumService } from '@services/datadog-rum.service';
import { FeatureFlagService } from '@services/feature-flag.service';
import { IntercomService } from '@services/intercom.service';
import { PersonaService } from '@services/persona.service';
import { PlausibleService } from '@services/plausible.service';
import { ProjectContextService } from '@services/project-context.service';
import { SegmentService } from '@services/segment.service';
import { UserService } from '@services/user.service';
import { MessageService } from 'primeng/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppComponent } from './app.component';
import { MeetingComposerService } from './modules/meetings/meeting-composer/meeting-composer.service';

/**
 * Covers the root-level half of `MEETING_V2_ENABLED_FLAG`: whether the composer host exists in the
 * tree at all, and whether its chunk is prefetched.
 *
 * This is the one gate that cannot be worked around from anywhere else. Every other entry point
 * decides which surface to *raise*; this one decides whether there is a composer to raise. A user
 * who is not targeted for meetings v2 must reach the end of a page load with no host mounted and no
 * v2 chunk fetched — not merely with the buttons that open it hidden.
 *
 * Asserted on the two reads rather than on the rendered host: the host sits inside `@defer`, and
 * with the composer closed that block renders nothing on either branch, so a `querySelector` for it
 * would pass with the flag on for the wrong reason. `app.component.html` spends both reads on one
 * `@if` and one `prefetch when`, so these are the whole gate; the rendered-host case is covered end
 * to end by the E2E flag specs.
 */
describe('AppComponent — meetings v2 flag', () => {
  /** `MEETING_V2_ENABLED_FLAG`. Stated per test rather than inherited: the real service answers `false` in a TestBed. */
  let meetingsV2Enabled: WritableSignal<boolean>;
  let canWrite: WritableSignal<boolean>;
  let currentPersona: WritableSignal<string>;
  /** `MeetingComposerService.isOpen()`. Only the last two tests move it off `false`. */
  let composerOpen: WritableSignal<boolean>;
  let segmentInitialize: ReturnType<typeof vi.fn>;
  let plausibleInitialize: ReturnType<typeof vi.fn>;
  let featureFlagInitialize: ReturnType<typeof vi.fn>;

  /** The two protected reads under test, surfaced the way the template sees them. */
  const flagState = (fixture: ComponentFixture<AppComponent>): { enabled: boolean; prefetch: boolean } => {
    const component = fixture.componentInstance as unknown as { meetingsV2Enabled: () => boolean; canPrefetchComposer: () => boolean };
    return { enabled: component.meetingsV2Enabled(), prefetch: component.canPrefetchComposer() };
  };

  /** The `@if` around the deferred host, read the way the template reads it. */
  const hostMounted = (fixture: ComponentFixture<AppComponent>): boolean =>
    (fixture.componentInstance as unknown as { composerHostMounted: () => boolean }).composerHostMounted();

  async function mount(): Promise<ComponentFixture<AppComponent>> {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: FeatureFlagService, useValue: { getBooleanFlag: () => meetingsV2Enabled, initialize: featureFlagInitialize } },
        { provide: ProjectContextService, useValue: { canWrite, selectedFoundation: signal(null), selectedProject: signal(null) } },
        { provide: PersonaService, useValue: { currentPersona } },
        { provide: MeetingComposerService, useValue: { isOpen: composerOpen } },
        {
          provide: UserService,
          useValue: {
            authenticated: signal(false),
            user: signal(null),
            canImpersonate: signal(false),
            impersonating: signal(false),
            impersonator: signal(null),
          },
        },
        { provide: SegmentService, useValue: { initialize: segmentInitialize, setImpersonating: vi.fn(), identifyUser: vi.fn() } },
        { provide: PlausibleService, useValue: { initialize: plausibleInitialize, setImpersonating: vi.fn() } },
        { provide: DataDogRumService, useValue: { setImpersonating: vi.fn(), setUser: vi.fn() } },
        { provide: AccountContextService, useValue: { initializeUserOrganizations: vi.fn() } },
        { provide: IntercomService, useValue: { boot: vi.fn() } },
        { provide: MessageService, useValue: { add: vi.fn() } },
      ],
    });
    // Empty template: see the suite comment — the root's markup is a toast, a router outlet and the
    // deferred host, none of which this suite asserts.
    TestBed.overrideComponent(AppComponent, { set: { template: '', imports: [], providers: [] } });
    await TestBed.compileComponents();

    const fixture = TestBed.createComponent(AppComponent);
    await fixture.whenStable();
    return fixture;
  }

  beforeEach(() => {
    meetingsV2Enabled = signal(false);
    canWrite = signal(true);
    currentPersona = signal('maintainer');
    composerOpen = signal(false);
    segmentInitialize = vi.fn();
    plausibleInitialize = vi.fn();
    featureFlagInitialize = vi.fn(() => Promise.resolve());
  });

  it('reads the flag off, so the host is left out of the tree', async () => {
    const fixture = await mount();

    expect(flagState(fixture).enabled).toBe(false);
  });

  it('reads the flag on once LaunchDarkly returns true for this user', async () => {
    meetingsV2Enabled.set(true);
    const fixture = await mount();

    expect(flagState(fixture).enabled).toBe(true);
  });

  it('does not prefetch the composer chunk for a writer who is not targeted', async () => {
    const fixture = await mount();

    // `canWrite` alone used to be the whole condition. Prefetching on it would pull the v2 bundle
    // down for every writer on the platform, including everyone the rollout has not reached.
    expect(flagState(fixture).prefetch).toBe(false);
  });

  it('prefetches for a targeted writer', async () => {
    meetingsV2Enabled.set(true);
    const fixture = await mount();

    expect(flagState(fixture).prefetch).toBe(true);
  });

  it('prefetches for a targeted executive director who holds no project write grant', async () => {
    meetingsV2Enabled.set(true);
    canWrite.set(false);
    currentPersona.set('executive-director');
    const fixture = await mount();

    expect(flagState(fixture).prefetch).toBe(true);
  });

  it('withholds the prefetch from an untargeted executive director too', async () => {
    canWrite.set(false);
    currentPersona.set('executive-director');
    const fixture = await mount();

    expect(flagState(fixture).prefetch).toBe(false);
  });

  it('keeps the host out of the tree while the flag is off and nothing is open', async () => {
    const fixture = await mount();

    expect(hostMounted(fixture)).toBe(false);
  });

  it('holds an already-open composer on screen when the flag goes false under it', async () => {
    meetingsV2Enabled.set(true);
    composerOpen.set(true);
    const fixture = await mount();
    expect(hostMounted(fixture)).toBe(true);

    // A live targeting change. Unmounting here would destroy the host-scoped form service and the
    // meeting the organizer is part-way through typing, while `isOpen()` stayed true — so the
    // composer would be gone from the screen and still logically open, and a later flag-on would
    // remount a host that reopens that stale context.
    meetingsV2Enabled.set(false);
    await fixture.whenStable();

    expect(hostMounted(fixture)).toBe(true);
    // The chunk trigger is not widened with it: nothing new is fetched for a user the flag just
    // turned off.
    expect(flagState(fixture).prefetch).toBe(false);

    // Still mounted after the close, deliberately: the create toast lives on the keyed outlet inside
    // the host and is published in the same tick as `close()`, so unmounting here would destroy it
    // before it painted and leave a successful create with no confirmation anywhere.
    composerOpen.set(false);
    await fixture.whenStable();

    expect(hostMounted(fixture)).toBe(true);
  });

  it('keeps the host out of the tree when the flag has never been true', async () => {
    // The latch is not a blanket opt-in: a user the flag never targeted mounts nothing, so the
    // once-mounted retention cannot become a way into v2 for them.
    const fixture = await mount();
    expect(hostMounted(fixture)).toBe(false);

    composerOpen.set(false);
    await fixture.whenStable();

    expect(hostMounted(fixture)).toBe(false);
    expect(flagState(fixture).prefetch).toBe(false);
  });

  it('settles on its own when LaunchDarkly resolves the flag after the page has rendered', async () => {
    // The fail-closed default is only acceptable because it is not final: both reads are signals, so
    // a late `true` has to take effect without a reload or a manual change-detection nudge.
    const fixture = await mount();
    expect(flagState(fixture)).toEqual({ enabled: false, prefetch: false });

    meetingsV2Enabled.set(true);
    await fixture.whenStable();

    expect(flagState(fixture)).toEqual({ enabled: true, prefetch: true });
  });

  it('does not initialize Segment or Plausible on /invite (GH-2290)', async () => {
    window.history.pushState({}, '', '/invite');
    try {
      await mount();
      expect(segmentInitialize).not.toHaveBeenCalled();
      expect(plausibleInitialize).not.toHaveBeenCalled();
      expect(featureFlagInitialize).not.toHaveBeenCalled();
    } finally {
      window.history.pushState({}, '', '/');
    }
  });

  it('initializes Segment and Plausible on a product route', async () => {
    await mount();
    expect(segmentInitialize).toHaveBeenCalledTimes(1);
    expect(plausibleInitialize).toHaveBeenCalledTimes(1);
  });
});
