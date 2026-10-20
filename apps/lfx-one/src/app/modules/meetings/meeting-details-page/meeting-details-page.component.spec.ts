// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass, NgTemplateOutlet } from '@angular/common';
import { Component, input, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ButtonComponent } from '@components/button/button.component';
import {
  Meeting,
  MeetingDetailsLoadStatus,
  MeetingRosterRequest,
  MeetingSectionVisibility,
  MeetingTimeState,
  PublicMeetingProject,
} from '@lfx-one/shared/interfaces';
import { UserService } from '@services/user.service';
import { SkeletonModule } from 'primeng/skeleton';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingDetailsPageComponent } from './meeting-details-page.component';
import { MeetingDetailsStateService } from './meeting-details-state.service';

// The identity bar and banner have their own specs; stubbing them keeps this spec on the page's branches.
@Component({ selector: 'lfx-meeting-identity-bar', template: '<header></header>' })
class IdentityBarStubComponent {
  public readonly condensed = input(false);
}

@Component({ selector: 'lfx-meeting-header', template: '<h1>stub header</h1>' })
class HeaderStubComponent {}

@Component({ selector: 'lfx-meeting-time-banner', template: '' })
class TimeBannerStubComponent {}

@Component({ selector: 'lfx-impersonation-banner', template: '' })
class ImpersonationBannerStubComponent {}

@Component({ selector: 'lfx-meeting-action-slot', template: '' })
class ActionSlotStubComponent {}

@Component({ selector: 'lfx-meeting-organizer', template: '' })
class OrganizerStubComponent {}

@Component({ selector: 'lfx-meeting-agenda', template: '<span data-testid="agenda-stub"></span>' })
class AgendaStubComponent {}

@Component({ selector: 'lfx-meeting-people', template: '<span data-testid="people-stub"></span>' })
class PeopleStubComponent {}

@Component({ selector: 'lfx-meeting-materials', template: '<span data-testid="materials-stub"></span>' })
class MaterialsStubComponent {}

@Component({ selector: 'lfx-meeting-recording', template: '<span data-testid="recording-stub"></span>' })
class RecordingStubComponent {}

@Component({ selector: 'lfx-meeting-attendance', template: '<span data-testid="attendance-stub"></span>' })
class AttendanceStubComponent {}

@Component({ selector: 'lfx-meeting-join-details', template: '<span data-testid="join-details-stub"></span>' })
class JoinDetailsStubComponent {}

@Component({ selector: 'lfx-meeting-occurrence-nav', template: '<span data-testid="occurrence-nav-stub"></span>' })
class OccurrenceNavStubComponent {}

describe('MeetingDetailsPageComponent', () => {
  let fixture: ComponentFixture<MeetingDetailsPageComponent>;
  let status: WritableSignal<MeetingDetailsLoadStatus>;
  let visibleSections: WritableSignal<Partial<MeetingSectionVisibility> | null>;
  let rosterRequest: WritableSignal<MeetingRosterRequest | null>;
  let timeState: WritableSignal<MeetingTimeState | null>;
  let refresh: ReturnType<typeof vi.fn>;
  let retrying: WritableSignal<boolean>;
  let failureCount: WritableSignal<number>;

  const meeting = { id: 'meeting-1', title: 'Weekly Sync', project: {} as PublicMeetingProject } as unknown as Meeting & { project: PublicMeetingProject };

  beforeEach(async () => {
    status = signal<MeetingDetailsLoadStatus>('loading');
    visibleSections = signal<Partial<MeetingSectionVisibility> | null>({ agenda: true, materials: true, occurrences: true });
    rosterRequest = signal<MeetingRosterRequest | null>({ meetingId: 'meeting-1', occurrenceId: undefined });
    timeState = signal<MeetingTimeState | null>('before');
    refresh = vi.fn();
    retrying = signal(false);
    failureCount = signal(1);

    await TestBed.configureTestingModule({
      imports: [MeetingDetailsPageComponent],
      providers: [{ provide: UserService, useValue: { impersonating: signal(false) } }],
    })
      .overrideComponent(MeetingDetailsPageComponent, {
        set: {
          imports: [
            NgClass,
            NgTemplateOutlet,
            ButtonComponent,
            ActionSlotStubComponent,
            AgendaStubComponent,
            AttendanceStubComponent,
            HeaderStubComponent,
            IdentityBarStubComponent,
            ImpersonationBannerStubComponent,
            JoinDetailsStubComponent,
            MaterialsStubComponent,
            OccurrenceNavStubComponent,
            OrganizerStubComponent,
            PeopleStubComponent,
            RecordingStubComponent,
            TimeBannerStubComponent,
            SkeletonModule,
          ],
          providers: [
            {
              provide: MeetingDetailsStateService,
              useValue: {
                status,
                meeting: signal(meeting),
                meetingTitle: signal(meeting.title),
                refresh,
                retrying,
                failureCount,
                visibleSections,
                rosterRequest,
                timeState,
              },
            },
          ],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(MeetingDetailsPageComponent);
    fixture.detectChanges();
  });

  afterEach(() => vi.unstubAllGlobals());

  const query = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);

  function show(next: MeetingDetailsLoadStatus): void {
    status.set(next);
    fixture.detectChanges();
  }

  it('renders the skeleton as a polite status region while loading', () => {
    const skeleton = query('meeting-skeleton');

    expect(skeleton?.getAttribute('role')).toBe('status');
    expect(skeleton?.getAttribute('aria-live')).toBe('polite');
    expect(query('meeting-content-column')).not.toBeNull();
    expect(query('meeting-header-section')).toBeNull();
    // The skeleton's columns hold no join details or occurrence navigation: the state may still hold the previous meeting.
    expect(query('join-details-stub')).toBeNull();
    expect(query('occurrence-nav-stub')).toBeNull();
  });

  it('renders the shell with the meeting header once ready', () => {
    show('ready');

    expect(query('meeting-skeleton')).toBeNull();
    expect(query('meeting-header-section')?.querySelector('lfx-meeting-header')).not.toBeNull();
    expect(query('meeting-content-column')).not.toBeNull();
    expect(query('join-details-stub')).not.toBeNull();
    expect(query('occurrence-nav-stub')).not.toBeNull();
    // #3260: a labelled region (not an <aside> inside <main>), with its own sr-only h2 once loaded.
    const rail = query('meeting-rail');
    expect(rail?.tagName).toBe('SECTION');
    expect(rail?.getAttribute('aria-label')).toBe('Meeting actions');
    expect(rail?.querySelector('h2')?.textContent?.trim()).toBe('Meeting actions');
  });

  // #3577: the rail comes before the content in the DOM, so on a stacked (mobile) layout Register /
  // Join sits right under the header, and reading and focus order reach it first; above 920px the
  // row is reversed so it still shows on the right.
  it('puts the action rail before the content column, reversed into the right column on wide screens', () => {
    show('ready');

    const rail = query('meeting-rail');
    const content = query('meeting-content-column');
    expect(rail?.compareDocumentPosition(content as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(rail?.parentElement).toBe(content?.parentElement);
    expect(rail?.parentElement?.className).toContain('min-[921px]:flex-row-reverse');
  });

  // #3260 (WCAG 2.4.11): focused controls scroll clear of the sticky identity bar, only while the page is up.
  it('pads the scroll root under the sticky bar while mounted', () => {
    show('ready');
    expect(document.documentElement.style.scrollPaddingTop).toBe('100px');

    fixture.destroy();
    expect(document.documentElement.style.scrollPaddingTop).toBe('');
  });

  // The skeleton projects the columns into its polite live region: no heading may be read out with it.
  it('keeps the rail heading out of the loading live region', () => {
    show('loading');
    expect(query('meeting-skeleton')?.querySelector('h2')).toBeNull();
  });

  it('gives every state the one h1', () => {
    show('error');
    expect(fixture.nativeElement.querySelectorAll('h1')).toHaveLength(1);

    show('loading');
    expect(fixture.nativeElement.querySelectorAll('h1')).toHaveLength(1);
  });

  // E3-01: the agenda follows the page's section visibility (hidden for an ended meeting without access).
  it('renders the occurrence navigation only for a series', () => {
    show('ready');
    expect(query('occurrence-nav-stub')).not.toBeNull();

    visibleSections.set({ agenda: true, materials: true, occurrences: false });
    fixture.detectChanges();

    expect(query('occurrence-nav-stub')).toBeNull();
  });

  it('renders the agenda only where the section visibility allows it', () => {
    show('ready');
    expect(query('agenda-stub')).not.toBeNull();

    visibleSections.set({ agenda: false });
    fixture.detectChanges();
    expect(query('agenda-stub')).toBeNull();
  });

  // E3-02: materials follow the page's section visibility (hidden for an ended meeting without access).
  it('renders the materials only where the section visibility allows them', () => {
    show('ready');
    expect(query('materials-stub')).not.toBeNull();

    visibleSections.set({ agenda: true, materials: false });
    fixture.detectChanges();
    expect(query('materials-stub')).toBeNull();
  });

  // E4-01: recording and transcript follow the tools flag (ended, with artifact access).
  it('renders the recording and transcript only where the section visibility allows them', () => {
    show('ready');
    expect(query('recording-stub')).toBeNull();

    visibleSections.set({ agenda: true, materials: true, tools: true });
    fixture.detectChanges();
    expect(query('recording-stub')).not.toBeNull();
  });

  // E3-04: the people section renders only for a viewer the state gives a roster to.
  it('renders the people section only when the viewer has a roster', () => {
    show('ready');
    expect(query('people-stub')).not.toBeNull();

    rosterRequest.set(null);
    fixture.detectChanges();
    expect(query('people-stub')).toBeNull();
  });

  // V1 parity: an ended meeting shows its attendance figures; the component itself hides with nobody to count.
  it('renders the attendance figures only once the meeting has ended and the page is ready', () => {
    timeState.set('ended');
    expect(query('attendance-stub')).toBeNull();

    show('ready');
    expect(query('attendance-stub')).not.toBeNull();

    timeState.set('live');
    fixture.detectChanges();
    expect(query('attendance-stub')).toBeNull();
  });

  // Placeholder testids are temporary (testid-contract.md), so this asserts on whatever skeleton
  // blocks remain rather than on their names or how many there are.
  it('keeps every skeleton block out of the accessibility tree', () => {
    show('ready');

    const skeletons: NodeListOf<Element> = fixture.nativeElement.querySelectorAll('[data-testid="meeting-page-shell"] p-skeleton');
    skeletons.forEach((el) => expect(el.getAttribute('aria-hidden')).toBe('true'));
  });

  it('renders the error state as an alert, with a retry that re-runs the lookup', () => {
    show('error');

    const error = query('meeting-error-state');
    expect(error?.getAttribute('role')).toBe('alert');
    expect(query('meeting-content-column')).toBeNull();

    query('meeting-error-retry-button')?.querySelector('button')?.click();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('shows the retry in progress, and changes the alert copy when a retry fails again', () => {
    show('error');
    expect(query('meeting-error-state')?.textContent).toContain('Something went wrong loading this meeting.');

    retrying.set(true);
    fixture.detectChanges();
    expect(query('meeting-error-retry-button')?.querySelector('button')?.disabled).toBe(true);

    retrying.set(false);
    failureCount.set(2);
    fixture.detectChanges();
    expect(query('meeting-error-state')?.textContent).toContain("We still couldn't load this meeting.");
  });

  it('keeps the page shell in every branch, for the gate e2e to find', () => {
    for (const next of ['loading', 'ready', 'error'] as const) {
      show(next);
      expect(query('meeting-page-shell')).not.toBeNull();
    }
  });

  it('drops the sticky rail below the impersonation banner as the identity bar does', () => {
    show('ready');
    const rail = (): HTMLElement | null => query('meeting-rail');
    expect(rail()?.classList).toContain('min-[921px]:top-[115px]');

    (TestBed.inject(UserService).impersonating as WritableSignal<boolean>).set(true);
    fixture.detectChanges();

    expect(rail()?.classList).toContain('min-[921px]:top-[157px]');
    expect(rail()?.classList).not.toContain('min-[921px]:top-[115px]');
  });

  it('scopes the V2 design tokens to a wrapper inside the page', () => {
    expect(fixture.nativeElement.querySelector('.meeting-details-v2')).not.toBeNull();
  });

  // jsdom has no IntersectionObserver; a fake one stands in so the test drives the callback itself.
  it('condenses the identity bar once the page header scrolls behind it', async () => {
    let callback: IntersectionObserverCallback | undefined;
    let observed: Element | undefined;
    const disconnect = vi.fn();
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        public constructor(cb: IntersectionObserverCallback, options?: IntersectionObserverInit) {
          callback = cb;
          expect(options?.rootMargin).toBe('-131px 0px 0px 0px');
        }
        public observe(el: Element): void {
          observed = el;
        }
        public disconnect(): void {
          disconnect();
        }
      }
    );

    // Where the sticky bar ends, e.g. an 83px bar under the 48px impersonation banner.
    vi.spyOn(fixture.nativeElement.querySelector('lfx-meeting-identity-bar header') as HTMLElement, 'getBoundingClientRect').mockReturnValue({
      bottom: 131,
    } as DOMRect);

    show('ready');
    await fixture.whenStable();
    const bar = (): IdentityBarStubComponent => fixture.debugElement.query((el) => el.componentInstance instanceof IdentityBarStubComponent).componentInstance;

    expect(observed).toBe(query('meeting-header-section'));
    expect(bar().condensed()).toBe(false);

    callback?.([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver);
    fixture.detectChanges();
    expect(bar().condensed()).toBe(true);

    callback?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    fixture.detectChanges();
    expect(bar().condensed()).toBe(false);

    // A batch with several crossings: the last entry is the current state.
    callback?.([{ isIntersecting: true }, { isIntersecting: false }] as IntersectionObserverEntry[], {} as IntersectionObserver);
    fixture.detectChanges();
    expect(bar().condensed()).toBe(true);

    // Leaving the ready branch removes the header, so the observer is torn down with it.
    show('loading');
    await fixture.whenStable();
    expect(disconnect).toHaveBeenCalled();
  });
});
