// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, NavigationEnd, Router } from '@angular/router';
import { ALL_LENSES } from '@lfx-one/shared/constants';
import { AppService } from '@services/app.service';
import { LensService } from '@services/lens.service';
import { ProjectContextService } from '@services/project-context.service';
import { SidebarNavService } from '@services/sidebar-nav.service';
import { UserService } from '@services/user.service';
import { FocusTrap } from 'primeng/focustrap';
import { Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { MainLayoutComponent } from './main-layout.component';

interface LayoutHarness {
  fixture: ComponentFixture<MainLayoutComponent>;
  appService: AppService;
  routerEvents: Subject<unknown>;
  /** Ends a navigation as the router reports it: `currentNavigation()` still names it while `NavigationEnd` is emitted. */
  endNavigation: (extras?: { replaceUrl?: boolean }, trigger?: 'imperative' | 'popstate') => void;
  menuButton: () => HTMLButtonElement;
  backdrop: () => HTMLElement | null;
  panel: () => HTMLElement;
}

/**
 * Renders the real layout template with its child components stubbed out (NO_ERRORS_SCHEMA), so the hamburger and backdrop
 * bindings are exercised. PrimeNG's focus trap is the real directive.
 */
const createLayout = async (): Promise<LayoutHarness> => {
  const routerEvents = new Subject<unknown>();
  const currentNavigation = signal<{ extras: { replaceUrl?: boolean }; trigger: 'imperative' | 'popstate' } | null>(null);
  const route = { snapshot: { data: {}, queryParamMap: new Map() }, firstChild: null };
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [MainLayoutComponent],
    providers: [
      { provide: Router, useValue: { url: '/org/acme/overview', events: routerEvents, currentNavigation } },
      { provide: ActivatedRoute, useValue: route },
      {
        provide: LensService,
        useValue: {
          activeLens: signal('org'),
          menuLens: signal('org'),
          availableLenses: signal([ALL_LENSES.me, ALL_LENSES.org]),
          setLens: vi.fn(() => true),
        },
      },
      { provide: ProjectContextService, useValue: { setRouteLensKind: vi.fn() } },
      { provide: SidebarNavService, useValue: { sidebarItems: signal([]) } },
      { provide: UserService, useValue: { impersonating: signal(false) } },
    ],
  });
  TestBed.overrideComponent(MainLayoutComponent, { set: { imports: [NgClass, FocusTrap], schemas: [NO_ERRORS_SCHEMA] } });
  const fixture = TestBed.createComponent(MainLayoutComponent);
  await fixture.whenStable();
  const element = fixture.nativeElement as HTMLElement;
  return {
    fixture,
    appService: TestBed.inject(AppService),
    routerEvents,
    endNavigation: (extras = {}, trigger = 'imperative') => {
      currentNavigation.set({ extras, trigger });
      routerEvents.next(new NavigationEnd(1, '/org/overview', '/org/acme/overview'));
      currentNavigation.set(null);
    },
    menuButton: () => element.querySelector<HTMLButtonElement>('[data-testid="mobile-menu-button"]')!,
    backdrop: () => element.querySelector<HTMLElement>('[data-testid="mobile-sidebar-backdrop"]'),
    panel: () => element.querySelector<HTMLElement>('[data-testid="mobile-sidebar-drawer"]')!,
  };
};

describe('MainLayoutComponent mobile drawer', () => {
  it('opens the drawer and its backdrop from the hamburger', async () => {
    const { fixture, appService, menuButton, backdrop } = await createLayout();

    menuButton().click();
    await fixture.whenStable();

    expect(appService.showMobileSidebar()).toBe(true);
    expect(backdrop()).not.toBeNull();
    expect(menuButton().getAttribute('aria-expanded')).toBe('true');
  });

  // The regression in #4172: a drawer whose state was left open while it was not usable turned the next tap into a close.
  it('keeps the drawer open when the hamburger is tapped while the state is already open', async () => {
    const { fixture, appService, menuButton } = await createLayout();
    appService.openMobileSidebar();
    await fixture.whenStable();

    menuButton().click();
    await fixture.whenStable();

    expect(appService.showMobileSidebar()).toBe(true);
  });

  it('closes from the backdrop, and the hamburger reopens it', async () => {
    const { fixture, appService, menuButton, backdrop } = await createLayout();
    menuButton().click();
    await fixture.whenStable();

    backdrop()!.click();
    await fixture.whenStable();
    expect(appService.showMobileSidebar()).toBe(false);
    expect(backdrop()).toBeNull();

    menuButton().click();
    await fixture.whenStable();
    expect(appService.showMobileSidebar()).toBe(true);
  });

  it('closes on Escape', async () => {
    const { fixture, appService } = await createLayout();
    appService.openMobileSidebar();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await fixture.whenStable();

    expect(appService.showMobileSidebar()).toBe(false);
  });

  it('leaves the drawer open on Escape while an overlay opened above it is still open', async () => {
    const { fixture, appService } = await createLayout();
    appService.openMobileSidebar();
    const popover = document.createElement('div');
    popover.className = 'p-popover';
    document.body.appendChild(popover);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await fixture.whenStable();
    expect(appService.showMobileSidebar()).toBe(true);

    popover.remove();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await fixture.whenStable();
    expect(appService.showMobileSidebar()).toBe(false);
  });

  // The iOS half of #4172: the panel's visibility is bound to the state itself, so it can't stay hidden while the state says open.
  it('shows the panel exactly while the state is open, and makes it inert while closed', async () => {
    const { fixture, appService, menuButton, panel } = await createLayout();
    expect(panel().classList.contains('is-open')).toBe(false);
    expect(panel().hasAttribute('inert')).toBe(true);

    menuButton().click();
    await fixture.whenStable();
    expect(panel().classList.contains('is-open')).toBe(true);
    expect(panel().hasAttribute('inert')).toBe(false);

    appService.closeMobileSidebar();
    await fixture.whenStable();
    expect(panel().classList.contains('is-open')).toBe(false);
    expect(panel().hasAttribute('inert')).toBe(true);
  });

  it('mounts the drawer navbar on the first open and keeps it mounted after closing', async () => {
    const { fixture, appService, menuButton, panel } = await createLayout();
    expect(panel().querySelector('lfx-navbar')).toBeNull();

    menuButton().click();
    await fixture.whenStable();
    expect(panel().querySelector('lfx-navbar')).not.toBeNull();

    appService.closeMobileSidebar();
    await fixture.whenStable();
    expect(panel().querySelector('lfx-navbar')).not.toBeNull();
  });

  it('closes on navigation, so a lens switch from the drawer leaves it closed and reopenable', async () => {
    const { fixture, appService, routerEvents, menuButton, backdrop } = await createLayout();
    appService.openMobileSidebar();

    routerEvents.next(new NavigationEnd(1, '/org', '/org/acme/overview'));
    await fixture.whenStable();
    expect(appService.showMobileSidebar()).toBe(false);
    expect(backdrop()).toBeNull();

    menuButton().click();
    await fixture.whenStable();
    expect(appService.showMobileSidebar()).toBe(true);
  });

  // #4172 on iPhone in Org Lens: the default organization written into the address, or a page syncing its query params,
  // must not close a drawer the viewer just opened.
  it('stays open through a navigation that rewrites the address in place', async () => {
    const { fixture, appService, endNavigation } = await createLayout();
    appService.openMobileSidebar();

    endNavigation({ replaceUrl: true });
    await fixture.whenStable();

    expect(appService.showMobileSidebar()).toBe(true);
  });

  it('closes on back/forward even though it lands with replaceUrl', async () => {
    const { fixture, appService, endNavigation } = await createLayout();
    appService.openMobileSidebar();

    endNavigation({ replaceUrl: true }, 'popstate');
    await fixture.whenStable();

    expect(appService.showMobileSidebar()).toBe(false);
  });

  it('moves focus into the drawer when it opens and back to the menu button when it closes', async () => {
    const { fixture, appService, menuButton, panel } = await createLayout();
    document.body.appendChild(fixture.nativeElement);

    menuButton().click();
    await fixture.whenStable();
    expect(document.activeElement).toBe(panel());

    appService.closeMobileSidebar();
    await fixture.whenStable();
    expect(document.activeElement).toBe(menuButton());

    fixture.nativeElement.remove();
  });

  // Focus lands inside the trap's sentinels, so an immediate Shift+Tab wraps within the drawer rather than leaving it.
  it("moves focus to the drawer's first visible control when it opens", async () => {
    const { fixture, menuButton, panel } = await createLayout();
    document.body.appendChild(fixture.nativeElement);
    const hidden = document.createElement('button');
    const first = document.createElement('button');
    // jsdom lays nothing out, so stand in for a rendered control and a display:none one.
    first.getClientRects = () => [{}] as unknown as DOMRectList;
    panel().append(hidden, first);

    menuButton().click();
    await fixture.whenStable();
    expect(document.activeElement).toBe(first);

    fixture.nativeElement.remove();
  });

  // A company pick closes the drawer while focus is still in the selector panel, which PrimeNG appends to <body>.
  it('returns focus to the menu button when the drawer closes from an overlay opened above it', async () => {
    const { fixture, appService, menuButton } = await createLayout();
    document.body.appendChild(fixture.nativeElement);
    menuButton().click();
    await fixture.whenStable();
    const popover = document.createElement('div');
    popover.className = 'p-popover';
    const option = document.createElement('button');
    popover.appendChild(option);
    document.body.appendChild(popover);
    option.focus();

    appService.closeMobileSidebar();
    await fixture.whenStable();
    expect(document.activeElement).toBe(menuButton());

    popover.remove();
    fixture.nativeElement.remove();
  });

  it('keeps keyboard focus inside the open drawer, and drops the trap once it closes', async () => {
    const { fixture, appService, menuButton, panel } = await createLayout();
    document.body.appendChild(fixture.nativeElement);
    const sentinels = () => panel().querySelectorAll<HTMLElement>('[data-p-hidden-focusable="true"]');

    menuButton().click();
    await fixture.whenStable();
    const link = document.createElement('a');
    link.href = '/org/acme/overview';
    sentinels()[0].after(link);

    // Tabbing past either end lands on one of the trap's sentinels, which hands focus back inside the panel.
    expect(sentinels()).toHaveLength(2);
    sentinels()[1].focus();
    expect(document.activeElement).toBe(link);
    sentinels()[0].focus();
    expect(document.activeElement).toBe(link);

    appService.closeMobileSidebar();
    await fixture.whenStable();
    expect(sentinels()).toHaveLength(0);

    fixture.nativeElement.remove();
  });
});
