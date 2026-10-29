// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { IMPERSONATION_BANNER_HEIGHT_PX } from '@lfx-one/shared/constants';
import { UserService } from '@services/user.service';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingsRedesignComponent } from './meetings-redesign.component';

describe('MeetingsRedesignComponent', () => {
  const HEADER_HEIGHT = 80;
  let impersonating: ReturnType<typeof signal<boolean>>;
  let desktop: boolean;

  const render = (): ComponentFixture<MeetingsRedesignComponent> => {
    const fixture = TestBed.createComponent(MeetingsRedesignComponent);
    fixture.detectChanges();
    return fixture;
  };
  const query = (fixture: ComponentFixture<MeetingsRedesignComponent>, testId: string): HTMLElement | null =>
    fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);

  beforeEach(() => {
    desktop = true;
    impersonating = signal(false);
    vi.stubGlobal(
      'ResizeObserver',
      class {
        public observe = vi.fn();
        public unobserve = vi.fn();
        public disconnect = vi.fn();
      }
    );
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: desktop, media: q }));
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(HEADER_HEIGHT);
    TestBed.configureTestingModule({ providers: [{ provide: UserService, useValue: { impersonating } }] });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders the header, tabs bar, list area and right column blocks', async () => {
    const fixture = render();
    await fixture.whenStable();

    expect(query(fixture, 'meetings-redesign-title')?.textContent).toContain('Meetings');
    expect(query(fixture, 'ui-tab-upcoming')).toBeTruthy();
    expect(query(fixture, 'ui-tab-past')).toBeTruthy();
    expect(query(fixture, 'meetings-redesign-search')).toBeTruthy();
    expect(query(fixture, 'meetings-redesign-list')?.getAttribute('role')).toBe('tabpanel');
    for (const block of ['next-meeting', 'last-meeting', 'pending-rsvps']) {
      expect(query(fixture, `meetings-redesign-rail-${block}`)).toBeTruthy();
      expect(query(fixture, `meetings-redesign-folded-${block}`)).toBeTruthy();
    }
  });

  it('has no Create meeting button', async () => {
    const fixture = render();
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).not.toContain('Create meeting');
  });

  it('links the tab panel to the selected tab', async () => {
    const fixture = render();
    await fixture.whenStable();
    fixture.detectChanges();

    const panel = query(fixture, 'meetings-redesign-list');
    expect(panel?.getAttribute('aria-labelledby')).toBe('meetings-redesign-tab-upcoming');
    expect(query(fixture, 'ui-tab-upcoming')?.getAttribute('aria-controls')).toBe(panel?.id);
  });

  it('sticks the tabs bar below the measured header on desktop', async () => {
    const fixture = render();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(query(fixture, 'meetings-redesign-header')?.style.top).toBe('0px');
    expect(query(fixture, 'meetings-redesign-tabs-bar')?.style.top).toBe(`${HEADER_HEIGHT}px`);
  });

  it("counts the layout wrapper's bottom padding, not main's own, in the desktop column height", async () => {
    vi.stubGlobal('innerHeight', 900);
    // The real shape: main (own padding) > content wrapper (21px) > route-entry host stand-in > the page.
    const main = document.createElement('main');
    main.style.paddingBottom = '40px';
    const wrapper = document.createElement('div');
    wrapper.style.paddingBottom = '21px';
    const entryHost = document.createElement('div');
    main.append(wrapper);
    wrapper.append(entryHost);
    document.body.append(main);

    try {
      const fixture = TestBed.createComponent(MeetingsRedesignComponent);
      entryHost.append(fixture.nativeElement);
      fixture.detectChanges();
      await fixture.whenStable();

      expect(query(fixture, 'meetings-redesign')?.style.height).toBe('879px');
    } finally {
      main.remove();
    }
  });

  it('keeps the measured column height on a short viewport, with no minimum height', async () => {
    vi.stubGlobal('innerHeight', 400);
    const fixture = render();
    await fixture.whenStable();

    const root = query(fixture, 'meetings-redesign');
    expect(root?.style.height).toBe('400px');
    expect(root?.className).not.toContain('min-h-');
  });

  it('clears the impersonation banner when the window scrolls', async () => {
    desktop = false;
    impersonating.set(true);
    const fixture = render();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(query(fixture, 'meetings-redesign-header')?.style.top).toBe(`${IMPERSONATION_BANNER_HEIGHT_PX}px`);
    expect(query(fixture, 'meetings-redesign-tabs-bar')?.style.top).toBe(`${IMPERSONATION_BANNER_HEIGHT_PX + HEADER_HEIGHT}px`);
  });
});
