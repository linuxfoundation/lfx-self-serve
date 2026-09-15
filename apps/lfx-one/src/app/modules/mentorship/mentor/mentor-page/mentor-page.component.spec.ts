// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MentorPageComponent } from './mentor-page.component';

/**
 * `<router-outlet>` needs the full router context (ChildrenOutletContexts, etc.) that a
 * unit spec would rather not stand up. The shell's job under test is the tab bar, so
 * stand the outlet down and drive the shell against a stubbed `Router`.
 *
 * The selector deliberately matches Angular's `<router-outlet>` tag rather than an
 * `lfx-` prefix — the whole point of the stub is to shadow that exact tag in the
 * shell's template. `.claude/rules/development-rules.md`'s `lfx-` prefix rule is for
 * real feature components; a test-only substitute for an Angular built-in tag is the
 * narrow exception, and `@angular-eslint/component-selector` is silenced here for
 * exactly that reason.
 */
@Component({
  // eslint-disable-next-line @angular-eslint/component-selector -- test-only stub for Angular's <router-outlet>
  selector: 'router-outlet',
  template: '',
})
class StubRouterOutletComponent {}

interface RouterStub {
  url: string;
  events: Subject<unknown>;
  navigate: ReturnType<typeof vi.fn>;
}

describe('MentorPageComponent', () => {
  let fixture: ComponentFixture<MentorPageComponent>;
  let router: RouterStub;

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;

  const bootstrap = async (initialUrl = '/mentorship/mentor/programs'): Promise<void> => {
    router = {
      url: initialUrl,
      events: new Subject<unknown>(),
      navigate: vi.fn(),
    };

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [MentorPageComponent],
      providers: [{ provide: Router, useValue: router }],
    });

    await TestBed.overrideComponent(MentorPageComponent, {
      remove: { imports: [RouterOutlet] },
      add: { imports: [StubRouterOutletComponent] },
    }).compileComponents();

    fixture = TestBed.createComponent(MentorPageComponent);
    fixture.detectChanges();
  };

  /**
   * Simulate a completed navigation, the way the real Router does. `activeTab` reads
   * off the URL signal, which is fed by `NavigationEnd` — so both the URL and the event
   * have to move together for the shell's view to update.
   */
  const navigateTo = (url: string): void => {
    router.url = url;
    router.events.next(new NavigationEnd(1, url, url));
    fixture.detectChanges();
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts on the programs tab and reflects its label in the H1', async () => {
    await bootstrap();

    expect(element().querySelector('[data-testid="mentorship-mentor-page-title"]')?.textContent?.trim()).toBe('My Programs');
    const active = element().querySelector<HTMLButtonElement>('[data-testid="mentorship-mentor-page-tab-programs"]');
    expect(active?.getAttribute('aria-selected')).toBe('true');
    expect(active?.getAttribute('tabindex')).toBe('0');
  });

  it('starts on the profile tab when the deep link lands there', async () => {
    // The shell has to read the initial URL, not just wait for a NavigationEnd — otherwise
    // deep-linking to `/mentorship/mentor/profile` would render the shell as if the mentor
    // clicked the programs tab first.
    await bootstrap('/mentorship/mentor/profile');

    expect(element().querySelector('[data-testid="mentorship-mentor-page-title"]')?.textContent?.trim()).toBe('Mentor Profile');
    expect(element().querySelector('[data-testid="mentorship-mentor-page-tab-profile"]')?.getAttribute('aria-selected')).toBe('true');
  });

  it('navigates to the profile route when the profile tab is clicked', async () => {
    await bootstrap();

    element().querySelector<HTMLButtonElement>('[data-testid="mentorship-mentor-page-tab-profile"]')?.click();

    expect(router.navigate).toHaveBeenCalledWith(['/mentorship/mentor', 'profile']);
  });

  it('updates the H1 and aria-selected state after the router confirms the navigation', async () => {
    await bootstrap();

    navigateTo('/mentorship/mentor/profile');

    expect(element().querySelector('[data-testid="mentorship-mentor-page-title"]')?.textContent?.trim()).toBe('Mentor Profile');
    expect(element().querySelector('[data-testid="mentorship-mentor-page-tab-profile"]')?.getAttribute('aria-selected')).toBe('true');
    expect(element().querySelector('[data-testid="mentorship-mentor-page-tab-programs"]')?.getAttribute('aria-selected')).toBe('false');
  });

  it('moves focus and navigates with ArrowRight', async () => {
    await bootstrap();

    const tablist = element().querySelector('[data-testid="mentorship-mentor-page-tabs"]') as HTMLElement;
    const profileTab = element().querySelector<HTMLButtonElement>('[data-testid="mentorship-mentor-page-tab-profile"]');
    const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });

    tablist.dispatchEvent(event);
    fixture.detectChanges();

    expect(event.defaultPrevented).toBe(true);
    expect(router.navigate).toHaveBeenCalledWith(['/mentorship/mentor', 'profile']);
    expect(document.activeElement).toBe(profileTab);
  });

  it('wraps to the last tab with ArrowLeft from the first, so keyboard nav is a loop', async () => {
    await bootstrap();

    const tablist = element().querySelector('[data-testid="mentorship-mentor-page-tabs"]') as HTMLElement;
    tablist.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));

    expect(router.navigate).toHaveBeenCalledWith(['/mentorship/mentor', 'profile']);
  });

  it('jumps to the last tab with End and the first with Home', async () => {
    await bootstrap();

    const tablist = element().querySelector('[data-testid="mentorship-mentor-page-tabs"]') as HTMLElement;
    tablist.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }));
    expect(router.navigate).toHaveBeenLastCalledWith(['/mentorship/mentor', 'profile']);

    navigateTo('/mentorship/mentor/profile');
    tablist.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }));
    expect(router.navigate).toHaveBeenLastCalledWith(['/mentorship/mentor', 'programs']);
  });

  it('ignores keys other than the roving arrows so typing does not shift focus', async () => {
    await bootstrap();

    const event = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true });
    const tablist = element().querySelector('[data-testid="mentorship-mentor-page-tabs"]') as HTMLElement;
    tablist.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(router.navigate).not.toHaveBeenCalled();
  });
});
