// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ApplicationRef, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, convertToParamMap, NavigationEnd, Router } from '@angular/router';
import { CommitteeService } from '@services/committee.service';
import { MeetingService } from '@services/meeting.service';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
import { CancelOnCommitteeRemoval, MeetingVisibility } from '@lfx-one/shared/enums';
import { Meeting } from '@lfx-one/shared/interfaces';
import { MessageService } from 'primeng/api';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingManageComponent } from './meeting-manage.component';

// Regression coverage for the relation-gated-null → uncached-detail context fallback (GH-1579):
// when the by-uid project lookup is relation-gated into null for an organizer without a viewer
// relation, the meeting detail is re-fetched uncached so its ungated enrichment can supply the
// project the lookup withheld. Also pins the retry-once guard (a fresh fetch must not repeat on
// every NavigationEnd step navigation) and the transient-error retry release.
// The nested "owner payload" describe pins the meeting-owner include/omit contract (GH-1673).
describe('MeetingManageComponent', () => {
  const MEETING_UID = 'meeting-uid-1';
  const PROJECT_UID = 'project-uid-1';
  const PROJECT_SLUG = 'test-project';

  let getMeetingDetail: ReturnType<typeof vi.fn>;
  let getProject: ReturnType<typeof vi.fn>;
  let routerEvents$: BehaviorSubject<NavigationEnd>;
  let setProject: ReturnType<typeof vi.fn>;

  // Unenriched detail payload: project_uid only, no project_slug — the trigger condition for
  // initMeetingContextFallback. Note `id` (not just `uid`): meetingEntityContext keys off
  // `meeting.id`, so a stub without it never reaches the fallback.
  const unenrichedMeeting = () =>
    ({
      id: MEETING_UID,
      uid: MEETING_UID,
      project_uid: PROJECT_UID,
      committees: [],
    }) as unknown as Meeting;

  const enrichedMeeting = () =>
    ({
      ...unenrichedMeeting(),
      project_slug: PROJECT_SLUG,
      project_name: 'Test Project',
      is_foundation: false,
    }) as unknown as Meeting;

  const createComponent = async () => {
    const fixture = TestBed.createComponent(MeetingManageComponent);
    // No fixture.detectChanges(): these tests exercise the constructor context-sync streams, not
    // the template, and rendering would pull in the full PrimeNG stepper subtree for no signal.
    await TestBed.inject(ApplicationRef).whenStable();
    return fixture;
  };

  const emitNavigationEnd = async () => {
    routerEvents$.next(new NavigationEnd(1, '/project/meetings/x/edit?step=2', '/project/meetings/x/edit?step=2'));
    await TestBed.inject(ApplicationRef).whenStable();
  };

  const skipCacheCalls = () => getMeetingDetail.mock.calls.filter(([, opts]) => (opts as { skipCache?: boolean } | undefined)?.skipCache === true);

  beforeEach(() => {
    getMeetingDetail = vi.fn();
    getProject = vi.fn();
    setProject = vi.fn();
    routerEvents$ = new BehaviorSubject<NavigationEnd>(new NavigationEnd(0, '/project/meetings/x/edit', '/project/meetings/x/edit'));

    TestBed.configureTestingModule({
      providers: [
        {
          provide: Router,
          useValue: {
            events: routerEvents$.asObservable(),
            url: '/project/meetings/x/edit',
            parseUrl: vi.fn().mockReturnValue({ queryParams: {} }),
            serializeUrl: vi.fn().mockReturnValue('/project/meetings/x/edit'),
            navigate: vi.fn(),
            createUrlTree: vi.fn(),
          },
        },
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: of(convertToParamMap({ id: MEETING_UID })),
            queryParamMap: of(convertToParamMap({})),
            snapshot: { queryParamMap: convertToParamMap({}), paramMap: convertToParamMap({ id: MEETING_UID }) },
          },
        },
        {
          provide: MeetingService,
          useValue: {
            // initializeMeeting probes via getMeeting; the fallback re-fetches via getMeetingDetail
            // with skipCache — both land on the same mock so call ordering stays inspectable.
            getMeeting: vi.fn().mockImplementation((id: string) => getMeetingDetail(id)),
            getMeetingDetail,
            getMeetingAttachments: vi.fn().mockReturnValue(of([])),
          },
        },
        { provide: ProjectService, useValue: { getProject, project: signal(null) } },
        {
          provide: ProjectContextService,
          useValue: {
            activeContext: () => null,
            activeContextUid: () => '',
            isFoundationContext: () => false,
            setProject,
            setFoundation: vi.fn(),
            setRouteLensKind: vi.fn(),
          },
        },
        { provide: CommitteeService, useValue: { getCommittee: vi.fn().mockReturnValue(of(null)), fetchCommittee: vi.fn().mockReturnValue(of(null)) } },
        // Transitive DI (LensService → PersonaService → HttpClient) — never called in these tests.
        { provide: HttpClient, useValue: { get: vi.fn().mockReturnValue(of(null)), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() } },
        // PrimeNG stepper binds @content.start animation listeners when the template is compiled —
        // required even without detectChanges(), since compilation alone wires the listener.
        provideNoopAnimations(),
        { provide: MessageService, useValue: { add: vi.fn() } },
      ],
    });
  });

  it('resolves context from a fresh uncached detail fetch when the uid lookup is relation-gated to null', async () => {
    getMeetingDetail.mockImplementation((_uid: string, opts?: { skipCache?: boolean }) => (opts?.skipCache ? of(enrichedMeeting()) : of(unenrichedMeeting())));
    getProject.mockReturnValue(of(null));
    await createComponent();

    // The uid lookup returned null, so the fallback re-fetched the detail uncached and resolved
    // the context from its (ungated) enrichment.
    expect(getMeetingDetail).toHaveBeenCalledWith(MEETING_UID, { skipCache: true });
    expect(setProject).toHaveBeenCalledWith({ uid: PROJECT_UID, name: 'Test Project', slug: PROJECT_SLUG }, false);
  });

  it('does not repeat the fresh fetch when NavigationEnd re-applies the fallback for the same meeting', async () => {
    getMeetingDetail.mockImplementation((_uid: string, opts?: { skipCache?: boolean }) => (opts?.skipCache ? of(enrichedMeeting()) : of(unenrichedMeeting())));
    getProject.mockReturnValue(of(null));
    await createComponent();

    const callsBefore = getMeetingDetail.mock.calls.length;
    await emitNavigationEnd();
    await emitNavigationEnd();

    // The fallback already resolved the context for this meeting, so step navigations must not
    // burn another uncached fetch.
    expect(skipCacheCalls()).toHaveLength(1);
    expect(getMeetingDetail.mock.calls.length).toBe(callsBefore);
  });

  it('releases the retry marker when the fresh fetch fails transiently, so a later navigation can retry', async () => {
    let failFreshFetch = false;
    getMeetingDetail.mockImplementation((_uid: string, opts?: { skipCache?: boolean }) => {
      if (!opts?.skipCache) {
        return of(unenrichedMeeting());
      }
      return failFreshFetch ? throwError(() => new Error('network')) : of(enrichedMeeting());
    });
    getProject.mockReturnValue(of(null));
    failFreshFetch = true;
    await createComponent();

    // Every fresh fetch so far failed transiently (the seeded initial NavigationEnd plus the
    // entity emission can each trigger one) — context untouched, marker released each time.
    const failedAttempts = skipCacheCalls().length;
    expect(failedAttempts).toBeGreaterThan(0);
    expect(setProject).not.toHaveBeenCalled();

    // …so the next NavigationEnd re-apply attempts the fresh fetch again and now resolves.
    failFreshFetch = false;
    await emitNavigationEnd();
    expect(skipCacheCalls().length).toBeGreaterThan(failedAttempts);
    expect(setProject).toHaveBeenCalledWith({ uid: PROJECT_UID, name: 'Test Project', slug: PROJECT_SLUG }, false);
  });

  // GH-1673: prepareOwnerData / syncHydratedOwnerFromForm are private but carry the owner
  // include/omit contract — re-sending an unchanged owner would replace the stored object
  // upstream and drop its profile_picture — so they get direct component-level coverage
  // rather than relying only on the (skippable) e2e suite.
  describe('owner payload (GH-1673)', () => {
    const HYDRATED = { username: 'ghopper', name: 'Grace Hopper', email: 'grace@example.com' };

    const createOwnerComponent = async () => {
      getMeetingDetail.mockReturnValue(of(unenrichedMeeting()));
      getProject.mockReturnValue(of(null));
      const fixture = await createComponent();
      // Private-member access is deliberate: the omit rule is the unit under test.
      return fixture.componentInstance as any;
    };

    it('omits owner when every control is empty or whitespace', async () => {
      const component = await createOwnerComponent();
      expect(component.prepareOwnerData({ ownerUsername: null, ownerName: '', ownerEmail: '   ' })).toEqual({});
    });

    it('omits owner when the trimmed values still match the hydrated owner', async () => {
      const component = await createOwnerComponent();
      component.hydratedOwner.set({ ...HYDRATED });
      expect(component.prepareOwnerData({ ownerUsername: ' ghopper ', ownerName: 'Grace Hopper', ownerEmail: 'grace@example.com' })).toEqual({});
    });

    it('includes only the non-empty owner fields when the selection changed', async () => {
      const component = await createOwnerComponent();
      component.hydratedOwner.set({ ...HYDRATED });
      // Manual-entry shape: no username — the key must not appear as an empty string.
      expect(component.prepareOwnerData({ ownerUsername: '', ownerName: 'Radia Perlman', ownerEmail: 'radia@example.com' })).toEqual({
        owner: { name: 'Radia Perlman', email: 'radia@example.com' },
      });
    });

    it('omits owner after a revert-to-saved brings the picker back in line with the hydrated owner', async () => {
      // Mirrors the organizer picker's revert affordance: the wizard patches the owner controls
      // back to the saved baseline (meeting-details.component.ts's revertOwnerToSaved), and the
      // next save must see no diff against hydratedOwner — same contract as an untouched picker.
      const component = await createOwnerComponent();
      component.hydratedOwner.set({ ...HYDRATED });
      component.form().patchValue({ ownerUsername: 'someone-else', ownerName: 'Someone Else', ownerEmail: 'someone@example.com' });
      expect(component.prepareOwnerData(component.form().getRawValue())).toEqual({
        owner: { username: 'someone-else', name: 'Someone Else', email: 'someone@example.com' },
      });

      component.form().patchValue({ ownerUsername: HYDRATED.username, ownerName: HYDRATED.name, ownerEmail: HYDRATED.email });
      expect(component.prepareOwnerData(component.form().getRawValue())).toEqual({});
    });

    it('re-baselines on syncHydratedOwnerFromForm so a repeat save omits the unchanged owner', async () => {
      const component = await createOwnerComponent();
      component.form().patchValue({ ownerUsername: HYDRATED.username, ownerName: HYDRATED.name, ownerEmail: HYDRATED.email });

      // First save sends the owner (nothing hydrated yet)…
      expect(component.prepareOwnerData(component.form().getRawValue())).toEqual({ owner: { ...HYDRATED } });

      // …the success handler re-baselines…
      component.syncHydratedOwnerFromForm();

      // …so an untouched second save omits the key (upstream keeps the enriched stored owner).
      expect(component.prepareOwnerData(component.form().getRawValue())).toEqual({});
    });

    it('keeps the previous baseline when the form is empty — that save omitted the key, so the stored owner is unchanged', async () => {
      const component = await createOwnerComponent();
      component.hydratedOwner.set({ ...HYDRATED });
      component.syncHydratedOwnerFromForm();
      expect(component.hydratedOwner()).toEqual(HYDRATED);
    });
  });

  // Pins the stale-value fix: hiding the override control (private meeting, or no linked
  // committees) must not let a previously-chosen cancel/keep value leak into the save payload.
  describe('cancel_on_committee_removal payload gating', () => {
    const createPayloadComponent = async () => {
      getMeetingDetail.mockReturnValue(of(unenrichedMeeting()));
      getProject.mockReturnValue(of(null));
      const fixture = await createComponent();
      return fixture.componentInstance as any;
    };

    it('preserves an explicit cancel/keep override on a public meeting with a linked committee', async () => {
      const component = await createPayloadComponent();
      component.form().patchValue({
        visibility: MeetingVisibility.PUBLIC,
        committees: [{ uid: 'committee-1' }],
        cancel_on_committee_removal: CancelOnCommitteeRemoval.CANCEL,
      });
      expect(component.prepareMeetingData().cancel_on_committee_removal).toBe(CancelOnCommitteeRemoval.CANCEL);
    });

    it('forces inherit when the meeting is private, even if a stale override value remains in the form', async () => {
      const component = await createPayloadComponent();
      component.form().patchValue({
        visibility: MeetingVisibility.PRIVATE,
        committees: [{ uid: 'committee-1' }],
        cancel_on_committee_removal: CancelOnCommitteeRemoval.CANCEL,
      });
      expect(component.prepareMeetingData().cancel_on_committee_removal).toBe(CancelOnCommitteeRemoval.INHERIT);
    });

    it('forces inherit when no committee is linked, even if a stale override value remains in the form', async () => {
      const component = await createPayloadComponent();
      component.form().patchValue({
        visibility: MeetingVisibility.PUBLIC,
        committees: [],
        cancel_on_committee_removal: CancelOnCommitteeRemoval.KEEP,
      });
      expect(component.prepareMeetingData().cancel_on_committee_removal).toBe(CancelOnCommitteeRemoval.INHERIT);
    });
  });
});
