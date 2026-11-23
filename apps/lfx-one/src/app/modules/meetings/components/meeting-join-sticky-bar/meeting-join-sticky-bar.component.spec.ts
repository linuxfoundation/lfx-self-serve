// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { PHONE_MEDIA_QUERY } from '@lfx-one/shared/constants';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OverlayStateService } from '../../../../shared/services/overlay-state.service';
import { MeetingJoinStickyBarComponent } from './meeting-join-sticky-bar.component';

describe('MeetingJoinStickyBarComponent', () => {
  const realMatchMedia = window.matchMedia;
  let phone: boolean;

  const stubMatchMedia = () => {
    window.matchMedia = vi.fn((query: string) => ({
      matches: query === PHONE_MEDIA_QUERY ? phone : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })) as unknown as typeof window.matchMedia;
  };

  const create = async (platform: 'browser' | 'server' = 'browser'): Promise<ComponentFixture<MeetingJoinStickyBarComponent>> => {
    TestBed.configureTestingModule({ providers: [{ provide: PLATFORM_ID, useValue: platform }] });
    const fixture = TestBed.createComponent(MeetingJoinStickyBarComponent);
    await fixture.whenStable();
    return fixture;
  };

  const testId = (fixture: ComponentFixture<unknown>, id: string) => fixture.nativeElement.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

  beforeEach(() => {
    phone = true;
    stubMatchMedia();
  });
  afterEach(() => {
    window.matchMedia = realMatchMedia;
  });

  it('puts Resend Invite before the Join button', async () => {
    const fixture = await create();
    fixture.componentRef.setInput('primaryAction', 'resend');
    await fixture.whenStable();

    const resend = testId(fixture, 'sticky-resend-invite') as HTMLElement;
    const join = testId(fixture, 'sticky-join') as HTMLElement;
    expect(resend.textContent).toContain('Resend Invite');
    expect(resend.compareDocumentPosition(join) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(testId(fixture, 'sticky-subscribe-calendar')).toBeNull();
  });

  it('shows the resend as in flight (disabled) while the request is pending', async () => {
    const fixture = await create();
    fixture.componentRef.setInput('primaryAction', 'resend');
    fixture.componentRef.setInput('resending', true);
    await fixture.whenStable();

    expect(testId(fixture, 'sticky-resend-invite')?.querySelector('button')?.disabled).toBe(true);
  });

  it('emits resendInvite when the primary button is pressed', async () => {
    const fixture = await create();
    fixture.componentRef.setInput('primaryAction', 'resend');
    await fixture.whenStable();
    const emitted = vi.fn();
    fixture.componentInstance.resendInvite.subscribe(emitted);

    fixture.debugElement.query(By.css('[data-testid="sticky-resend-invite"]')).triggerEventHandler('onClick', new MouseEvent('click'));

    expect(emitted).toHaveBeenCalledTimes(1);
  });

  it('asks the page to open the subscribe dialog; Subscribe is a button, not a link to a new tab', async () => {
    const fixture = await create();
    fixture.componentRef.setInput('primaryAction', 'subscribe');
    await fixture.whenStable();
    const emitted = vi.fn();
    fixture.componentInstance.subscribeCalendar.subscribe(emitted);

    const subscribe = testId(fixture, 'sticky-subscribe-calendar') as HTMLElement;
    expect(subscribe.querySelector('a')).toBeNull();
    expect(subscribe.getAttribute('target')).toBeNull();
    expect(testId(fixture, 'sticky-resend-invite')).toBeNull();

    fixture.debugElement.query(By.css('[data-testid="sticky-subscribe-calendar"]')).triggerEventHandler('onClick', new MouseEvent('click'));
    expect(emitted).toHaveBeenCalledTimes(1);
  });

  it('renders only the Join row when there is no primary action', async () => {
    const fixture = await create();

    expect(testId(fixture, 'sticky-resend-invite')).toBeNull();
    expect(testId(fixture, 'sticky-subscribe-calendar')).toBeNull();
    expect(testId(fixture, 'sticky-join')).not.toBeNull();
  });

  it('shows the unlock label on a disabled Join until the window opens', async () => {
    const fixture = await create();
    fixture.componentRef.setInput('unlockLabel', 'Join opens 11:50 AM');
    await fixture.whenStable();

    const join = testId(fixture, 'sticky-join') as HTMLElement;
    expect(join.textContent).toContain('Join opens 11:50 AM');
    expect(join.querySelector('button')?.disabled).toBe(true);
  });

  it('links Join to the resolved URL once the window is open', async () => {
    const fixture = await create();
    fixture.componentRef.setInput('canJoin', true);
    fixture.componentRef.setInput('joinHref', 'https://zoom.example/j/1');
    await fixture.whenStable();

    const anchor = testId(fixture, 'sticky-join')?.querySelector('a') as HTMLAnchorElement;
    expect(anchor.href).toBe('https://zoom.example/j/1');
    expect(anchor.rel).toContain('noopener');
  });

  it('keeps Join disabled but not loading when the join URL cannot be resolved', async () => {
    const fixture = await create();
    fixture.componentRef.setInput('canJoin', true);
    fixture.componentRef.setInput('joinUnavailable', true);
    await fixture.whenStable();

    const button = testId(fixture, 'sticky-join')?.querySelector('button');
    expect(button?.disabled).toBe(true);
    expect(testId(fixture, 'sticky-join')?.querySelector('.p-button-loading, .pi-spinner, [class*="spin"]')).toBeNull();
  });

  it.each(['javascript:alert(1)', 'data:text/html,x', '//evil.example/x'])('never binds a non-http(s) join URL (%s) to the anchor', async (href) => {
    const fixture = await create();
    fixture.componentRef.setInput('canJoin', true);
    fixture.componentRef.setInput('joinHref', href);
    await fixture.whenStable();

    expect(testId(fixture, 'sticky-join')?.querySelector('a')).toBeNull();
  });

  it('clears the safe area with a max() padding and is phone-only', async () => {
    const fixture = await create();

    const root = testId(fixture, 'meeting-join-sticky-bar') as HTMLElement;
    expect(root.className).toContain('pb-[max(0.75rem,env(safe-area-inset-bottom))]');
    expect(root.classList.contains('sm:hidden')).toBe(true);
    expect(root.classList.contains('fixed')).toBe(true);
  });

  describe('support launcher (stickyBarVisible)', () => {
    it('hides the launcher at phone width while mounted and releases it on destroy', async () => {
      const fixture = await create();
      const overlayState = TestBed.inject(OverlayStateService);
      expect(overlayState.stickyBarVisible()).toBe(true);

      fixture.destroy();

      expect(overlayState.stickyBarVisible()).toBe(false);
    });

    it('does not touch the launcher above phone width (desktop keeps its launcher)', async () => {
      phone = false;
      await create();
      const overlayState = TestBed.inject(OverlayStateService);

      expect(overlayState.stickyBarVisible()).toBe(false);
    });

    it('releases the launcher while suppressed (drawer open) and takes it back after', async () => {
      const fixture = await create();
      const overlayState = TestBed.inject(OverlayStateService);

      fixture.componentRef.setInput('suppressed', true);
      await fixture.whenStable();
      expect(overlayState.stickyBarVisible()).toBe(false);
      expect(testId(fixture, 'meeting-join-sticky-bar')).toBeNull();

      fixture.componentRef.setInput('suppressed', false);
      await fixture.whenStable();
      expect(overlayState.stickyBarVisible()).toBe(true);
    });

    it('gives the launcher back when the viewport grows past phone width (rotation)', async () => {
      let onChange: ((event: MediaQueryListEvent) => void) | undefined;
      window.matchMedia = vi.fn(() => ({
        matches: true,
        addEventListener: (_type: string, handler: (event: MediaQueryListEvent) => void) => (onChange = handler),
        removeEventListener: vi.fn(),
      })) as unknown as typeof window.matchMedia;
      const fixture = await create();
      const overlayState = TestBed.inject(OverlayStateService);
      expect(overlayState.stickyBarVisible()).toBe(true);

      onChange?.({ matches: false } as MediaQueryListEvent);
      await fixture.whenStable();

      expect(overlayState.stickyBarVisible()).toBe(false);
    });

    it('never writes it during server rendering', async () => {
      await create('server');
      const overlayState = TestBed.inject(OverlayStateService);

      expect(overlayState.stickyBarVisible()).toBe(false);
      expect(window.matchMedia).not.toHaveBeenCalled();
    });
  });
});
