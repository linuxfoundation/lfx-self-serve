// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { REQUEST_CONTEXT, TransferState, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { DEFAULT_RUNTIME_CONFIG, RUNTIME_CONFIG_KEY } from '@app/shared/providers/runtime-config.provider';
import { AuthContext, User } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { DataDogRumService } from '@services/datadog-rum.service';
import { FeatureFlagService } from '@services/feature-flag.service';
import { IntercomService } from '@services/intercom.service';
import { PersonaService } from '@services/persona.service';
import { PlausibleService } from '@services/plausible.service';
import { ProjectContextService } from '@services/project-context.service';
import { SegmentService } from '@services/segment.service';
import { TranscendService } from '@services/transcend.service';
import { UserService } from '@services/user.service';
import { MessageService } from 'primeng/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppComponent } from './app.component';
import { MeetingComposerService } from './modules/meetings/meeting-composer/meeting-composer.service';

/**
 * Covers the root component: whether the composer chunk is prefetched, and which analytics start.
 *
 * Asserted on `canPrefetchComposer` rather than on the rendered host: the host sits inside `@defer`,
 * and with the composer closed that block renders nothing, so a `querySelector` for it would prove
 * nothing.
 */
describe('AppComponent', () => {
  let canWrite: WritableSignal<boolean>;
  let currentPersona: WritableSignal<string>;
  /** `MeetingComposerService.isOpen()`. */
  let composerOpen: WritableSignal<boolean>;
  let segmentInitialize: ReturnType<typeof vi.fn>;
  let plausibleInitialize: ReturnType<typeof vi.fn>;
  let featureFlagInitialize: ReturnType<typeof vi.fn>;
  let segmentIdentifyUser: ReturnType<typeof vi.fn>;
  let segmentSetImpersonating: ReturnType<typeof vi.fn>;
  let plausibleSetImpersonating: ReturnType<typeof vi.fn>;
  let dataDogSetUser: ReturnType<typeof vi.fn>;
  let intercomBoot: ReturnType<typeof vi.fn>;
  let intercomSetIdentity: ReturnType<typeof vi.fn>;

  const authedUser: User = {
    sid: 'sid',
    'https://sso.linuxfoundation.org/claims/username': 'alice',
    'http://lfx.dev/claims/intercom': 'intercom-jwt',
    given_name: 'Alice',
    family_name: 'Example',
    nickname: 'alice',
    name: 'Alice Example',
    picture: '',
    updated_at: '',
    email: 'alice@example.com',
    email_verified: true,
    sub: 'auth0|alice',
  };

  const authedContext: AuthContext = {
    authenticated: true,
    user: authedUser,
    persona: null,
    organizations: [],
  };

  const prefetches = (fixture: ComponentFixture<AppComponent>): boolean =>
    (fixture.componentInstance as unknown as { canPrefetchComposer: () => boolean }).canPrefetchComposer();

  async function mount(options?: { auth?: AuthContext; framed?: boolean }): Promise<ComponentFixture<AppComponent>> {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: FeatureFlagService, useValue: { initialize: featureFlagInitialize } },
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
        { provide: SegmentService, useValue: { initialize: segmentInitialize, setImpersonating: segmentSetImpersonating, identifyUser: segmentIdentifyUser } },
        { provide: PlausibleService, useValue: { initialize: plausibleInitialize, setImpersonating: plausibleSetImpersonating } },
        { provide: DataDogRumService, useValue: { setImpersonating: vi.fn(), setUser: dataDogSetUser } },
        { provide: AccountContextService, useValue: { initializeUserOrganizations: vi.fn() } },
        { provide: IntercomService, useValue: { boot: intercomBoot, setIdentity: intercomSetIdentity } },
        { provide: MessageService, useValue: { add: vi.fn() } },
        ...(options?.auth ? [{ provide: REQUEST_CONTEXT, useValue: { auth: options.auth } }] : []),
        // A frame whose airgap.js suppresses Transcend's UI (lfx-self-serve-ops#1438).
        ...(options?.framed ? [{ provide: TranscendService, useValue: { preferencesAvailable: false } }] : []),
      ],
    });
    // Empty template: see the suite comment — the root's markup is a toast, a router outlet and the
    // deferred host, none of which this suite asserts.
    TestBed.overrideComponent(AppComponent, { set: { template: '', imports: [], providers: [] } });
    await TestBed.compileComponents();

    if (options?.auth) {
      TestBed.inject(TransferState).set(RUNTIME_CONFIG_KEY, { ...DEFAULT_RUNTIME_CONFIG, intercomAppId: 'test-app-id' });
    }

    const fixture = TestBed.createComponent(AppComponent);
    await fixture.whenStable();
    return fixture;
  }

  beforeEach(() => {
    canWrite = signal(true);
    currentPersona = signal('maintainer');
    composerOpen = signal(false);
    segmentInitialize = vi.fn();
    plausibleInitialize = vi.fn();
    featureFlagInitialize = vi.fn(() => Promise.resolve());
    segmentIdentifyUser = vi.fn();
    segmentSetImpersonating = vi.fn();
    plausibleSetImpersonating = vi.fn();
    dataDogSetUser = vi.fn();
    intercomBoot = vi.fn();
    intercomSetIdentity = vi.fn();
  });

  it('prefetches the composer chunk for a writer', async () => {
    const fixture = await mount();

    expect(prefetches(fixture)).toBe(true);
  });

  it('prefetches for an executive director who holds no project write grant', async () => {
    canWrite.set(false);
    currentPersona.set('executive-director');
    const fixture = await mount();

    expect(prefetches(fixture)).toBe(true);
  });

  it('leaves the chunk to the click for a user with no write grant', async () => {
    canWrite.set(false);
    const fixture = await mount();

    expect(prefetches(fixture)).toBe(false);
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

  it('skips feature flags, Segment identify, and Intercom boot on authenticated /invite (GH-2290)', async () => {
    window.history.pushState({}, '', '/invite');
    try {
      await mount({ auth: authedContext });
      expect(featureFlagInitialize).not.toHaveBeenCalled();
      expect(segmentIdentifyUser).not.toHaveBeenCalled();
      expect(segmentSetImpersonating).not.toHaveBeenCalled();
      expect(plausibleSetImpersonating).not.toHaveBeenCalled();
      expect(intercomBoot).not.toHaveBeenCalled();
      expect(dataDogSetUser).toHaveBeenCalledWith(authedUser);
    } finally {
      window.history.pushState({}, '', '/');
    }
  });

  it('stages the Intercom identity without booting on authenticated /invite (GH-2290)', async () => {
    window.history.pushState({}, '', '/invite');
    try {
      await mount({ auth: authedContext });
      // Staged, not booted: first paint stays off the widget, but "Contact support" on
      // /invite/error still opens as the signed-in user.
      expect(intercomBoot).not.toHaveBeenCalled();
      expect(intercomSetIdentity).toHaveBeenCalledWith(
        expect.objectContaining({
          app_id: 'test-app-id',
          user_id: 'alice',
          name: 'Alice Example',
          email: 'alice@example.com',
          intercom_user_jwt: 'intercom-jwt',
        })
      );
    } finally {
      window.history.pushState({}, '', '/');
    }
  });

  it('stages no Intercom identity while impersonating, so support boots anonymously', async () => {
    // buildImpersonationIdentityOverride leaves `http://lfx.dev/claims/intercom` as the operator's
    // own JWT, so identifying from the overridden user would send that JWT with the target's PII.
    await mount({ auth: { ...authedContext, impersonating: true } });

    expect(intercomSetIdentity).not.toHaveBeenCalled();
    expect(intercomBoot).not.toHaveBeenCalled();
  });

  it('stages no Intercom identity while impersonating on /invite either', async () => {
    window.history.pushState({}, '', '/invite');
    try {
      await mount({ auth: { ...authedContext, impersonating: true } });

      expect(intercomSetIdentity).not.toHaveBeenCalled();
      expect(intercomBoot).not.toHaveBeenCalled();
    } finally {
      window.history.pushState({}, '', '/');
    }
  });

  it('keeps URL-capturing analytics off the mentor-invite page, but still loads feature flags', async () => {
    window.history.pushState({}, '', '/mentorship/mentor/invites?token=payload.sig');
    try {
      await mount({ auth: authedContext });
      expect(segmentInitialize).not.toHaveBeenCalled();
      expect(plausibleInitialize).not.toHaveBeenCalled();
      expect(segmentIdentifyUser).not.toHaveBeenCalled();
      expect(intercomBoot).not.toHaveBeenCalled();
      // Only URL-capturing integrations are skipped on a credential URL; feature flags still load.
      expect(featureFlagInitialize).toHaveBeenCalledWith(authedUser);
    } finally {
      window.history.pushState({}, '', '/');
    }
  });

  it('initializes Segment and Plausible on a product route', async () => {
    await mount();
    expect(segmentInitialize).toHaveBeenCalledTimes(1);
    expect(plausibleInitialize).toHaveBeenCalledTimes(1);
  });

  it('starts no Segment or Plausible inside a frame without a consent notice, but still loads feature flags (lfx-self-serve-ops#1438)', async () => {
    await mount({ auth: authedContext, framed: true });
    expect(segmentInitialize).not.toHaveBeenCalled();
    expect(plausibleInitialize).not.toHaveBeenCalled();
    expect(segmentIdentifyUser).not.toHaveBeenCalled();
    expect(featureFlagInitialize).toHaveBeenCalledWith(authedUser);
  });

  it('identifies Segment, initializes flags, and boots Intercom on an authenticated product route', async () => {
    await mount({ auth: authedContext });
    expect(segmentIdentifyUser).toHaveBeenCalledWith(authedUser);
    expect(featureFlagInitialize).toHaveBeenCalledWith(authedUser);
    expect(intercomBoot).toHaveBeenCalled();
    expect(intercomSetIdentity).toHaveBeenCalled();
    expect(dataDogSetUser).toHaveBeenCalledWith(authedUser);
  });
});
