// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass, NgTemplateOutlet } from '@angular/common';
import { Component, input, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ButtonComponent } from '@components/button/button.component';
import { Meeting, MeetingDetailsLoadStatus, PublicMeetingProject } from '@lfx-one/shared/interfaces';
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

describe('MeetingDetailsPageComponent', () => {
  let fixture: ComponentFixture<MeetingDetailsPageComponent>;
  let status: WritableSignal<MeetingDetailsLoadStatus>;
  let refresh: ReturnType<typeof vi.fn>;
  let retrying: WritableSignal<boolean>;
  let failureCount: WritableSignal<number>;

  const meeting = { id: 'meeting-1', title: 'Weekly Sync', project: {} as PublicMeetingProject } as unknown as Meeting & { project: PublicMeetingProject };

  beforeEach(async () => {
    status = signal<MeetingDetailsLoadStatus>('loading');
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
            HeaderStubComponent,
            IdentityBarStubComponent,
            ImpersonationBannerStubComponent,
            TimeBannerStubComponent,
            SkeletonModule,
          ],
          providers: [{ provide: MeetingDetailsStateService, useValue: { status, meeting: signal(meeting), refresh, retrying, failureCount } }],
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
  });

  it('renders the shell with the meeting header once ready', () => {
    show('ready');

    expect(query('meeting-skeleton')).toBeNull();
    expect(query('meeting-header-section')?.querySelector('lfx-meeting-header')).not.toBeNull();
    expect(query('meeting-content-column')).not.toBeNull();
    expect(query('meeting-rail')?.getAttribute('aria-label')).toBe('Meeting actions');
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
