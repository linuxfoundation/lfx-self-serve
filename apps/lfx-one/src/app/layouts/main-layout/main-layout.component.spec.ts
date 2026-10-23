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
import { Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { MainLayoutComponent } from './main-layout.component';

interface LayoutHarness {
  fixture: ComponentFixture<MainLayoutComponent>;
  appService: AppService;
  routerEvents: Subject<unknown>;
  menuButton: () => HTMLButtonElement;
  backdrop: () => HTMLElement | null;
}

/** Renders the real layout template with its child components stubbed out (NO_ERRORS_SCHEMA), so the hamburger and backdrop bindings are exercised. */
const createLayout = async (): Promise<LayoutHarness> => {
  const routerEvents = new Subject<unknown>();
  const route = { snapshot: { data: {}, queryParamMap: new Map() }, firstChild: null };
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [MainLayoutComponent],
    providers: [
      { provide: Router, useValue: { url: '/org/acme/overview', events: routerEvents } },
      { provide: ActivatedRoute, useValue: route },
      {
        provide: LensService,
        useValue: { activeLens: signal('org'), availableLenses: signal([ALL_LENSES.me, ALL_LENSES.org]), setLens: vi.fn(() => true) },
      },
      { provide: ProjectContextService, useValue: { setRouteLensKind: vi.fn() } },
      { provide: SidebarNavService, useValue: { sidebarItems: signal([]) } },
      { provide: UserService, useValue: { impersonating: signal(false) } },
    ],
  });
  TestBed.overrideComponent(MainLayoutComponent, { set: { imports: [NgClass], schemas: [NO_ERRORS_SCHEMA] } });
  const fixture = TestBed.createComponent(MainLayoutComponent);
  await fixture.whenStable();
  const element = fixture.nativeElement as HTMLElement;
  return {
    fixture,
    appService: TestBed.inject(AppService),
    routerEvents,
    menuButton: () => element.querySelector<HTMLButtonElement>('[data-testid="mobile-menu-button"]')!,
    backdrop: () => element.querySelector<HTMLElement>('[data-testid="mobile-sidebar-backdrop"]'),
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

  it('closes when the drawer reports itself hidden, and ignores a visible report', async () => {
    const { fixture, appService } = await createLayout();
    appService.openMobileSidebar();

    fixture.componentInstance.onDrawerVisibilityChange(true);
    expect(appService.showMobileSidebar()).toBe(true);

    fixture.componentInstance.onDrawerVisibilityChange(false);
    expect(appService.showMobileSidebar()).toBe(false);
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
});
