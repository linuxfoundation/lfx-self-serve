// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, signal } from '@angular/core';
import type { Signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DefaultUrlSerializer, Router } from '@angular/router';
import { ALL_LENSES, NAVBAR_ROLE_STYLES } from '@lfx-one/shared/constants';
import type {
  Lens,
  LensOption,
  NavbarMenuBlock,
  NavbarRoleMark,
  NavbarTabIndicator,
  PersonaProject,
  PersonaType,
  SidebarMenuItem,
  User,
} from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { AppService } from '@services/app.service';
import { NavbarCollapseService } from '@services/navbar-collapse.service';
import { ChangelogService } from '@services/changelog.service';
import { CreatePermissionService } from '@services/create-permission.service';
import { FeatureFlagService } from '@services/feature-flag.service';
import { LensService } from '@services/lens.service';
import { NavigationService } from '@services/navigation.service';
import { OrgLensNavigationService } from '@services/org-lens-navigation.service';
import { PersonaService } from '@services/persona.service';
import { ProjectContextService } from '@services/project-context.service';
import { SidebarNavService } from '@services/sidebar-nav.service';
import { UserService } from '@services/user.service';
import { NavTooltipDirective } from '@shared/directives/nav-tooltip.directive';
import { DialogService } from 'primeng/dynamicdialog';
import { EMPTY } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NavbarComponent } from './navbar.component';

/** The navbar's protected view state, reached through a narrow cast (template is overridden empty). */
interface NavbarView {
  menuBlocks: Signal<NavbarMenuBlock<SidebarMenuItem & { trackKey: string }>[]>;
  lensTabs: Signal<LensOption[]>;
  roleMarks: Signal<NavbarRoleMark[]>;
  isDocsActive: Signal<boolean>;
  showNoAccessState: Signal<'foundation' | 'project' | null>;
  menuPending: Signal<boolean>;
  menuLookupFailed: Signal<boolean>;
  retryingLookups: Signal<boolean>;
  menuStateReady: Signal<boolean>;
  announcedNoAccessState: Signal<'foundation' | 'project' | null>;
  showPartialLookupFailed: Signal<boolean>;
  announcedPartialLookupFailed: Signal<boolean>;
  tabIndicator: Signal<NavbarTabIndicator | null>;
  hydrated: WritableSignal<boolean>;
  activeLensId: Signal<Lens>;
  retryMenu(): void;
  switchLens(lens: Lens): void;
  onOrgSelected(): void;
  railVisible: Signal<boolean>;
  railDocked: Signal<boolean>;
  toggleLabel: Signal<string>;
  headTooltipPlacement: Signal<string>;
  onToggleClick(): void;
}

/**
 * A `LensService` stand-in whose menu lens behaves as the real one's (#4208): a preview shows another lens's menu while
 * `activeLens` — what the page renders from — stays put, a commit makes it active, a clear drops it.
 */
const createLensServiceFake = (lens: Lens, lenses: LensOption[]) => {
  const activeLens = signal<Lens>(lens);
  const preview = signal<Lens | null>(null);
  const menuLens = computed(() => preview() ?? activeLens());
  return {
    activeLens,
    menuLens,
    previewingMenuLens: computed(() => menuLens() !== activeLens()),
    menuPickPending: signal(false),
    displayMenuLens: menuLens,
    isHybridPersona: signal(false),
    availableLenses: signal(lenses),
    displayLenses: signal([ALL_LENSES.me, ALL_LENSES.project]),
    displayActiveLens: activeLens,
    setLens: vi.fn((next: Lens) => {
      activeLens.set(next);
      return true;
    }),
    switchLens: vi.fn(),
    previewMenuLens: vi.fn((next: Lens) => preview.set(next === activeLens() ? null : next)),
    commitMenuLens: vi.fn(() => {
      activeLens.set(menuLens());
      preview.set(null);
    }),
    clearMenuLensPreview: vi.fn(() => preview.set(null)),
  };
};

const retryMenuLookups = vi.fn();

const createNavbarFixture = async (
  items: SidebarMenuItem[],
  personas: PersonaType[] = [],
  personaProjects: Partial<Record<PersonaType, PersonaProject[]>> = {},
  {
    lens = 'me',
    itemsPending = false,
    tierResolved = true,
    lookupFailed = false,
    lenses = [ALL_LENSES.me, ALL_LENSES.project],
    mobile = false,
    url = '/',
    retrying = false,
    template = '',
  }: {
    lens?: Lens;
    itemsPending?: boolean;
    tierResolved?: boolean;
    lookupFailed?: boolean;
    lenses?: LensOption[];
    mobile?: boolean;
    url?: string;
    retrying?: boolean;
    template?: string;
  } = {}
): Promise<ComponentFixture<NavbarComponent>> => {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [NavbarComponent],
    providers: [
      { provide: Router, useValue: { url, events: EMPTY, navigate: vi.fn(), parseUrl: (value: string) => new DefaultUrlSerializer().parse(value) } },
      { provide: FeatureFlagService, useValue: { getBooleanFlag: vi.fn(() => signal(false)) } },
      { provide: LensService, useValue: createLensServiceFake(lens, lenses) },
      { provide: OrgLensNavigationService, useValue: { orgLensLink: vi.fn((page: string) => ['/org', 'acme', page]) } },
      {
        provide: UserService,
        useValue: {
          user: signal({ user_id: 'u1', name: 'Ada Lovelace' } as unknown as User),
          userInitials: computed(() => 'AL'),
          effectiveAvatarUrl: computed(() => ''),
          canImpersonate: signal(false),
          impersonating: signal(false),
        },
      },
      { provide: ProjectContextService, useValue: { activeContext: signal(null), menuContext: signal(null), activeRouteLensKind: signal(null) } },
      {
        provide: PersonaService,
        useValue: {
          isRootWriter: signal(false),
          personaProjects: signal(personaProjects),
          detectedProjects: signal([{ projectUid: 'uid-k8s', isFoundation: false, tierResolved }]),
          allPersonas: signal(personas),
          currentPersona: signal('contributor'),
        },
      },
      { provide: NavigationService, useValue: { loaded: vi.fn(() => signal(true)) } },
      { provide: AccountContextService, useValue: { hasOrgSelectorAccess: vi.fn(() => false) } },
      { provide: ChangelogService, useValue: { unseenChangelogCount: signal(0), loadUnseenCount: vi.fn() } },
      { provide: DialogService, useValue: { open: vi.fn() } },
      {
        provide: SidebarNavService,
        useValue: { sidebarItemsPending: signal(itemsPending), menuLookupFailed: signal(lookupFailed), menuRetryPending: signal(retrying), retryMenuLookups },
      },
      { provide: CreatePermissionService, useValue: { canShowCreateButton: signal(false), creatableTypes: signal([]) } },
    ],
  });
  TestBed.overrideComponent(NavbarComponent, { set: { template, imports: [], providers: [] } });
  const fixture = TestBed.createComponent(NavbarComponent);
  fixture.componentRef.setInput('items', items);
  fixture.componentRef.setInput('mobile', mobile);
  await fixture.whenStable();
  return fixture;
};

const createNavbar = async (...args: Parameters<typeof createNavbarFixture>): Promise<NavbarView> =>
  (await createNavbarFixture(...args)).componentInstance as unknown as NavbarView;

describe('NavbarComponent', () => {
  it('groups top-level runs and sections into spaced blocks, ruling off a dividerBefore run', async () => {
    const navbar = await createNavbar([
      { label: 'Dashboard', routerLink: '/dashboard' },
      { label: 'Meetings', routerLink: '/meetings' },
      { label: 'My Engagement', isSection: true, items: [{ label: 'Groups', routerLink: '/groups' }] },
      { label: 'Education', routerLink: '/education', dividerBefore: true },
      { label: 'Mentorship', routerLink: '/mentorship' },
    ]);

    const blocks = navbar.menuBlocks();

    expect(blocks.map((block) => block.section?.label ?? null)).toEqual([null, 'My Engagement', null]);
    expect(blocks.map((block) => block.items.map((item) => item.label))).toEqual([['Dashboard', 'Meetings'], ['Groups'], ['Education', 'Mentorship']]);
    expect(blocks.map((block) => block.ruleBefore)).toEqual([false, false, true]);
  });

  it('presents the Me lens as Home and leaves the other lenses as they are', async () => {
    const navbar = await createNavbar([]);

    expect(navbar.lensTabs().map((lens) => lens.label)).toEqual(['Home', ALL_LENSES.project.label]);
    expect(navbar.lensTabs()[0].activeIcon).toBe('fa-solid fa-house');
  });

  it('orders role marks by persona priority with each role’s navbar ink', async () => {
    const navbar = await createNavbar([], ['contributor', 'board-member', 'maintainer']);

    expect(navbar.roleMarks().map((role) => role.persona)).toEqual(['board-member', 'maintainer', 'contributor']);
    expect(navbar.roleMarks()[0].ink).toBe(NAVBAR_ROLE_STYLES['board-member'].ink);
  });

  it('turns a role’s projects into chips, taking the tier from detection and else from the role’s scope', async () => {
    const navbar = await createNavbar([], ['board-member'], {
      'board-member': [
        { projectUid: 'uid-k8s', projectSlug: 'kubernetes', projectName: 'Kubernetes' },
        { projectUid: 'uid-cncf', projectSlug: 'cncf', projectName: null },
      ],
    });

    const [mark] = navbar.roleMarks();

    expect(mark.projects.map((project) => [project.slug, project.name, project.isFoundation])).toEqual([
      ['kubernetes', 'Kubernetes', false],
      ['cncf', 'cncf', true],
    ]);
    expect(mark.chips).toEqual([
      { key: 'kubernetes', label: 'Kubernetes' },
      { key: 'cncf', label: 'cncf' },
    ]);
  });

  it('opens a role’s projects in a lens the viewer has, and lists one with no such lens as a plain label', async () => {
    const projects = {
      'board-member': [
        { projectUid: 'uid-k8s', projectSlug: 'kubernetes', projectName: 'Kubernetes' },
        { projectUid: 'uid-cncf', projectSlug: 'cncf', projectName: 'CNCF' },
      ],
    };

    // Board Member with Foundation but no Project lens: the confirmed non-foundation project has nowhere to open.
    const [foundationOnly] = (await createNavbar([], ['board-member'], projects, { lenses: [ALL_LENSES.me, ALL_LENSES.foundation] })).roleMarks();
    expect(foundationOnly.projects.map((project) => [project.slug, project.lens])).toEqual([
      ['kubernetes', null],
      ['cncf', 'foundation'],
    ]);
    expect(foundationOnly.chips).toEqual([
      { key: 'kubernetes', label: 'Kubernetes', static: true },
      { key: 'cncf', label: 'CNCF' },
    ]);

    // Project-only viewer: a foundation opens in the Project lens, as the selector shows it.
    const [projectOnly] = (await createNavbar([], ['board-member'], projects)).roleMarks();
    expect(projectOnly.projects.map((project) => project.lens)).toEqual(['project', 'project']);
  });

  it('trusts only an enrichment-resolved tier, falling back to the role’s scope before enrichment or on a batch miss', async () => {
    const projects = { 'board-member': [{ projectUid: 'uid-k8s', projectSlug: 'kubernetes', projectName: 'Kubernetes' }] };

    const [unenriched] = (await createNavbar([], ['board-member'], projects, { tierResolved: false })).roleMarks();
    const [enriched] = (await createNavbar([], ['board-member'], projects)).roleMarks();

    expect(unenriched.projects[0].isFoundation).toBe(true);
    expect(enriched.projects[0].isFoundation).toBe(false);
  });

  it('marks the Documentation button active anywhere under /docs, and only there', async () => {
    expect((await createNavbar([], [], {}, { url: '/docs/meetings/schedule-meeting' })).isDocsActive()).toBe(true);
    expect((await createNavbar([], [], {}, { url: '/docs' })).isDocsActive()).toBe(true);
    expect((await createNavbar([], [], {}, { url: '/meetings' })).isDocsActive()).toBe(false);
  });

  it('closes its body-level overlays as soon as the mobile drawer starts closing', async () => {
    const navbar = await createNavbar([], [], {}, { mobile: true });
    // The context selectors' panels are appended to `body` too; the template is empty, so stand in for them.
    const closeProjectPanel = vi.fn();
    const closeOrgPanel = vi.fn();
    Object.assign(navbar, { projectSelector: () => ({ closePanel: closeProjectPanel }), orgSelector: () => ({ closePanel: closeOrgPanel }) });
    const appService = TestBed.inject(AppService);
    appService.openMobileSidebar();
    TestBed.tick();
    const hideWithin = vi.spyOn(NavTooltipDirective, 'hideWithin');

    appService.closeMobileSidebar();
    TestBed.tick();
    expect(hideWithin).toHaveBeenCalledTimes(1);
    expect(closeProjectPanel).toHaveBeenCalledTimes(1);
    expect(closeOrgPanel).toHaveBeenCalledTimes(1);
    hideWithin.mockRestore();
  });

  it('announces the no-access state only through the same gate that shows the visible panel', async () => {
    const resolved = await createNavbar([], [], {}, { lens: 'foundation' });
    resolved.hydrated.set(false);
    expect(resolved.menuStateReady()).toBe(false);
    expect(resolved.announcedNoAccessState()).toBeNull();
    resolved.hydrated.set(true);
    expect(resolved.menuStateReady()).toBe(true);
    expect(resolved.announcedNoAccessState()).toBe(resolved.showNoAccessState());
    expect(resolved.announcedNoAccessState()).toBe('foundation');

    // Still pending: neither the panel nor the live region shows a state.
    const pending = await createNavbar([], [], {}, { lens: 'foundation', itemsPending: true });
    pending.hydrated.set(true);
    expect(pending.menuStateReady()).toBe(false);
    expect(pending.announcedNoAccessState()).toBeNull();
  });

  it('keeps the lookup-error card (not the skeleton) up while a retry runs', async () => {
    const navbar = await createNavbar([], [], {}, { lens: 'foundation', itemsPending: true, lookupFailed: true, retrying: true });

    expect(navbar.retryingLookups()).toBe(true);
    expect(navbar.menuPending()).toBe(false);
    expect(navbar.showNoAccessState()).toBe('foundation');
  });

  it('shows the no-access state once an empty project or foundation menu has resolved', async () => {
    expect((await createNavbar([], [], {}, { lens: 'foundation' })).showNoAccessState()).toBe('foundation');
    expect((await createNavbar([], [], {}, { lens: 'project' })).showNoAccessState()).toBe('project');
  });

  it('keeps the no-access state hidden while the menu is still pending, when it has items, or off a nav lens', async () => {
    expect((await createNavbar([], [], {}, { lens: 'project', itemsPending: true })).showNoAccessState()).toBeNull();
  });

  it('holds the skeleton while an empty nav-lens menu is pending, and only then', async () => {
    expect((await createNavbar([], [], {}, { lens: 'project', itemsPending: true })).menuPending()).toBe(true);
    expect((await createNavbar([], [], {}, { lens: 'project' })).menuPending()).toBe(false);
    expect((await createNavbar([], [], {}, { lens: 'me', itemsPending: true })).menuPending()).toBe(false);
    expect((await createNavbar([{ label: 'Dashboard', routerLink: '/project/overview' }], [], {}, { lens: 'project' })).showNoAccessState()).toBeNull();
    expect((await createNavbar([], [], {}, { lens: 'me' })).showNoAccessState()).toBeNull();
  });

  it('marks the empty-menu state as a failed lookup, not a denial, and retries through the service', async () => {
    const failed = await createNavbar([], [], {}, { lens: 'foundation', lookupFailed: true });
    const denied = await createNavbar([], [], {}, { lens: 'foundation' });

    expect(failed.showNoAccessState()).toBe('foundation');
    expect(failed.menuLookupFailed()).toBe(true);
    expect(denied.menuLookupFailed()).toBe(false);

    retryMenuLookups.mockClear();
    failed.retryMenu();
    expect(retryMenuLookups).toHaveBeenCalledTimes(1);
  });

  it('offers an inline retry when a lookup failed but the menu still has items (#3824)', async () => {
    const items: SidebarMenuItem[] = [{ label: 'Dashboard', routerLink: '/foundation/overview' }];
    const partial = await createNavbar(items, [], {}, { lens: 'foundation', lookupFailed: true });
    partial.hydrated.set(true);

    expect(partial.showNoAccessState()).toBeNull();
    expect(partial.showPartialLookupFailed()).toBe(true);
    expect(partial.announcedPartialLookupFailed()).toBe(true);

    retryMenuLookups.mockClear();
    partial.retryMenu();
    expect(retryMenuLookups).toHaveBeenCalledTimes(1);

    // The row stays up, busy, while that retry runs.
    expect((await createNavbar(items, [], {}, { lens: 'foundation', itemsPending: true, retrying: true })).showPartialLookupFailed()).toBe(true);
  });

  it('leaves the inline retry to the error card when the menu is empty, and hides it when nothing failed', async () => {
    const empty = await createNavbar([], [], {}, { lens: 'foundation', lookupFailed: true });
    expect(empty.showNoAccessState()).toBe('foundation');
    expect(empty.showPartialLookupFailed()).toBe(false);

    const healthy = await createNavbar([{ label: 'Dashboard', routerLink: '/foundation/overview' }], [], {}, { lens: 'foundation' });
    expect(healthy.showPartialLookupFailed()).toBe(false);

    // Off the foundation / project lenses the failed lookups don't shape the menu: no row on Home or Org.
    expect((await createNavbar([{ label: 'Dashboard', routerLink: '/' }], [], {}, { lens: 'me', lookupFailed: true })).showPartialLookupFailed()).toBe(false);
    expect(
      (await createNavbar([{ label: 'Overview', routerLink: '/org/overview' }], [], {}, { lens: 'org', lookupFailed: true })).showPartialLookupFailed()
    ).toBe(false);

    // Not announced before the visible panel shows the row.
    const unhydrated = await createNavbar([{ label: 'Dashboard', routerLink: '/foundation/overview' }], [], {}, { lens: 'foundation', lookupFailed: true });
    unhydrated.hydrated.set(false);
    expect(unhydrated.showPartialLookupFailed()).toBe(true);
    expect(unhydrated.announcedPartialLookupFailed()).toBe(false);
  });

  describe('mobile lens tabs preview a lens menu (#4208)', () => {
    const pickTemplate =
      '<a class="lfxn__item" href="/foundation/meetings" data-testid="pick">Meetings</a>' +
      '<a class="lfxn__item" href="https://docs.example.org" data-testid="external">Docs</a>';

    const lensServiceOf = () => TestBed.inject(LensService) as unknown as ReturnType<typeof createLensServiceFake>;

    it('switches lens and lands on its page from the desktop tabs, as before', async () => {
      const navbar = await createNavbar([], [], {}, { lens: 'me' });
      const lensService = lensServiceOf();

      navbar.switchLens('project');

      expect(lensService.switchLens).toHaveBeenCalledWith('project');
      expect(lensService.previewMenuLens).not.toHaveBeenCalled();
    });

    it('only previews the lens menu in the drawer: no navigation, the drawer stays open and the page lens is untouched', async () => {
      const navbar = await createNavbar([], [], {}, { lens: 'me', mobile: true });
      const lensService = lensServiceOf();
      const appService = TestBed.inject(AppService);
      appService.openMobileSidebar();
      TestBed.tick();

      navbar.switchLens('project');

      expect(lensService.previewMenuLens).toHaveBeenCalledWith('project');
      expect(lensService.switchLens).not.toHaveBeenCalled();
      expect(TestBed.inject(Router).navigate).not.toHaveBeenCalled();
      expect(appService.showMobileSidebar()).toBe(true);
      expect(navbar.activeLensId()).toBe('project');
      expect(lensService.activeLens()).toBe('me');
    });

    it('drops the preview when the drawer closes without a pick, leaving the page lens as it was', async () => {
      const navbar = await createNavbar([], [], {}, { lens: 'me', mobile: true });
      const lensService = lensServiceOf();
      const appService = TestBed.inject(AppService);
      appService.openMobileSidebar();
      TestBed.tick();
      navbar.switchLens('project');

      appService.closeMobileSidebar();
      TestBed.tick();

      expect(lensService.clearMenuLensPreview).toHaveBeenCalled();
      expect(lensService.menuLens()).toBe('me');
      expect(lensService.activeLens()).toBe('me');
      expect(lensService.setLens).not.toHaveBeenCalled();
      expect(lensService.commitMenuLens).not.toHaveBeenCalled();
    });

    it('drops the preview when the drawer navbar is destroyed before the drawer reports closing (a jump to another layout)', async () => {
      const fixture = await createNavbarFixture([], [], {}, { lens: 'me', mobile: true });
      const lensService = lensServiceOf();
      (fixture.componentInstance as unknown as NavbarView).switchLens('project');

      fixture.destroy();

      expect(lensService.previewingMenuLens()).toBe(false);
      expect(lensService.activeLens()).toBe('me');
    });

    it('commits the previewed lens when a page link in its menu is followed, before the router sees the click', async () => {
      const fixture = await createNavbarFixture([], [], {}, { lens: 'me', mobile: true, template: pickTemplate });
      const navbar = fixture.componentInstance as unknown as NavbarView;
      const lensService = lensServiceOf();
      navbar.switchLens('project');
      const link = fixture.nativeElement.querySelector('[data-testid="pick"]') as HTMLAnchorElement;
      // Stands in for RouterLink's own listener on the anchor: the lens must already be committed when it runs.
      let lensWhenRouted: Lens | null = null;
      link.addEventListener('click', (event) => {
        lensWhenRouted = lensService.activeLens();
        event.preventDefault();
      });

      link.click();

      expect(lensWhenRouted).toBe('project');
      expect(lensService.commitMenuLens).toHaveBeenCalledTimes(1);
      expect(lensService.previewingMenuLens()).toBe(false);
    });

    it('commits nothing for an external link, a modified click or a click without a preview', async () => {
      const fixture = await createNavbarFixture([], [], {}, { lens: 'me', mobile: true, template: pickTemplate });
      const navbar = fixture.componentInstance as unknown as NavbarView;
      const lensService = lensServiceOf();
      const pick = fixture.nativeElement.querySelector('[data-testid="pick"]') as HTMLAnchorElement;
      const external = fixture.nativeElement.querySelector('[data-testid="external"]') as HTMLAnchorElement;
      for (const link of [pick, external]) link.addEventListener('click', (event) => event.preventDefault());

      pick.click();
      expect(lensService.commitMenuLens).not.toHaveBeenCalled();

      navbar.switchLens('project');
      external.click();
      pick.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true }));

      expect(lensService.commitMenuLens).not.toHaveBeenCalled();
      expect(lensService.activeLens()).toBe('me');
    });

    it("lands an organization picked in a previewed Org Lens on that organization's overview, with Org Lens committed", async () => {
      const navbar = await createNavbar([], [], {}, { lens: 'me', mobile: true, lenses: [ALL_LENSES.me, ALL_LENSES.org] });
      const lensService = lensServiceOf();
      navbar.switchLens('org');

      navbar.onOrgSelected();

      expect(lensService.activeLens()).toBe('org');
      expect(TestBed.inject(Router).navigate).toHaveBeenCalledWith(['/org', 'acme', 'overview']);
    });

    it('only closes the drawer on an organization pick without a preview, leaving the address to the selector', async () => {
      const navbar = await createNavbar([], [], {}, { lens: 'org', mobile: true, lenses: [ALL_LENSES.me, ALL_LENSES.org] });
      const lensService = lensServiceOf();
      const appService = TestBed.inject(AppService);
      appService.openMobileSidebar();

      navbar.onOrgSelected();

      expect(appService.showMobileSidebar()).toBe(false);
      expect(lensService.commitMenuLens).not.toHaveBeenCalled();
      expect(TestBed.inject(Router).navigate).not.toHaveBeenCalled();
    });
  });

  describe('lens-tab pill (#3825)', () => {
    /** A ResizeObserver stand-in: records what it observes and lets a test fire its callback. */
    class FakeResizeObserver {
      public static readonly instances: FakeResizeObserver[] = [];
      public readonly observe = vi.fn();
      public readonly disconnect = vi.fn();

      public constructor(public readonly callback: () => void) {
        FakeResizeObserver.instances.push(this);
      }
    }

    // Only the measured markup: the tab group and its active tab.
    const tabsTemplate =
      '<div #lensTabGroup><button type="button" class="lfxn__tab">Home</button><button type="button" class="lfxn__tab is-active">Project</button></div>';

    afterEach(() => {
      vi.unstubAllGlobals();
      FakeResizeObserver.instances.length = 0;
    });

    it('re-measures the active tab when the group resizes, and stops observing on destroy', async () => {
      vi.stubGlobal('ResizeObserver', FakeResizeObserver);
      const fixture = await createNavbarFixture([], [], {}, { lens: 'project', template: tabsTemplate });
      const navbar = fixture.componentInstance as unknown as NavbarView;
      const group = fixture.nativeElement.querySelector('div') as HTMLElement;
      const active = group.querySelector('.is-active') as HTMLElement;

      // jsdom lays nothing out: an unmeasurable (0px) tab leaves the pill to the active tab's own styling.
      expect(navbar.tabIndicator()).toBeNull();
      expect(FakeResizeObserver.instances).toHaveLength(1);
      const [observer] = FakeResizeObserver.instances;
      expect(observer.observe).toHaveBeenCalledWith(group);

      // The group gets laid out (e.g. the mobile drawer opens): the resize callback places the pill.
      Object.defineProperty(active, 'offsetLeft', { configurable: true, value: 12 });
      Object.defineProperty(active, 'offsetWidth', { configurable: true, value: 64 });
      observer.callback();
      expect(navbar.tabIndicator()).toEqual({ left: 12, width: 64 });

      fixture.destroy();
      expect(observer.disconnect).toHaveBeenCalledTimes(1);
    });

    it('leaves the pill unplaced where ResizeObserver is unavailable', async () => {
      vi.stubGlobal('ResizeObserver', undefined);
      const fixture = await createNavbarFixture([], [], {}, { lens: 'project', template: tabsTemplate });

      expect((fixture.componentInstance as unknown as NavbarView).tabIndicator()).toBeNull();
      expect(() => fixture.destroy()).not.toThrow();
    });
  });

  describe('sidebar collapse', () => {
    afterEach(() => {
      vi.restoreAllMocks();
      localStorage.clear();
    });

    /** Reports every viewport as narrow (and non-touch) when `narrow`; otherwise matches nothing. */
    const stubViewport = (narrow: boolean): void => {
      vi.spyOn(window, 'matchMedia').mockImplementation(
        (media: string) =>
          ({ matches: narrow && media.includes('max-width'), media, addEventListener: vi.fn(), removeEventListener: vi.fn() }) as unknown as MediaQueryList
      );
    };

    it('docks to the rail and back from the toggle, relabelling it and moving rail tooltips beside their triggers', async () => {
      stubViewport(false);
      const fixture = await createNavbarFixture([]);
      const navbar = fixture.componentInstance as unknown as NavbarView;
      const collapse = TestBed.inject(NavbarCollapseService);

      expect(navbar.toggleLabel()).toBe('Close sidebar');
      expect(navbar.headTooltipPlacement()).toBe('bottom');

      navbar.onToggleClick();
      await fixture.whenStable();
      expect(collapse.collapsed()).toBe(true);
      expect(navbar.railVisible()).toBe(true);
      expect(navbar.toggleLabel()).toBe('Open sidebar');
      expect(navbar.headTooltipPlacement()).toBe('right');
      expect(fixture.nativeElement.classList).toContain('is-collapsed');

      navbar.onToggleClick();
      await fixture.whenStable();
      expect(collapse.collapsed()).toBe(false);
      expect(fixture.nativeElement.classList).not.toContain('is-collapsed');
    });

    it('docks open from a wide-viewport peek instead of closing it', async () => {
      stubViewport(false);
      const fixture = await createNavbarFixture([]);
      const navbar = fixture.componentInstance as unknown as NavbarView;
      const collapse = TestBed.inject(NavbarCollapseService);
      collapse.setCollapsed(true);
      collapse.openPeek();

      expect(navbar.toggleLabel()).toBe('Keep sidebar open');
      expect(navbar.railDocked()).toBe(true);
      navbar.onToggleClick();

      expect(collapse.collapsed()).toBe(false);
      expect(collapse.peek()).toBe(false);
      expect(navbar.railDocked()).toBe(false);
    });

    it('opens a pinned peek from the toggle on a narrow viewport, without touching the preference', async () => {
      stubViewport(true);
      const fixture = await createNavbarFixture([]);
      const navbar = fixture.componentInstance as unknown as NavbarView;
      const collapse = TestBed.inject(NavbarCollapseService);

      expect(navbar.railVisible()).toBe(true);
      navbar.onToggleClick();

      expect(collapse.peek()).toBe(true);
      expect(collapse.peekPinned()).toBe(true);
      expect(collapse.collapsed()).toBe(false);
      expect(navbar.railVisible()).toBe(false);
    });

    it('never collapses the mobile drawer’s navbar', async () => {
      stubViewport(true);
      const fixture = await createNavbarFixture([], [], {}, { mobile: true });
      const navbar = fixture.componentInstance as unknown as NavbarView;

      expect(navbar.railVisible()).toBe(false);
      expect(navbar.railDocked()).toBe(false);
      expect(fixture.nativeElement.classList).not.toContain('lfxn-host--dock');
    });
  });
});
