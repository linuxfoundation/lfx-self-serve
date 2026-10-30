// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, signal } from '@angular/core';
import type { Provider } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DefaultUrlSerializer, provideRouter, Router } from '@angular/router';
import type { IsActiveMatchOptions } from '@angular/router';
import { Lens, LensItem, ProjectContext, User } from '@lfx-one/shared/interfaces';
import type { SidebarMenuItem } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { LensService } from '@services/lens.service';
import { NavigationService } from '@services/navigation.service';
import { PersonaService } from '@services/persona.service';
import { ProjectContextService } from '@services/project-context.service';
import { UserService } from '@services/user.service';
import { EMPTY } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NavMenuBase } from './nav-menu-base.directive';

/** The smallest component the abstract base can be instantiated through; protected members are reached by narrow casts. */
@Component({ selector: 'lfx-nav-menu-test-host', template: '' })
class NavMenuTestHostComponent extends NavMenuBase {}

const navMenuServiceStubs = (setProject = vi.fn()): Provider[] => [
  {
    provide: LensService,
    useValue: {
      activeLens: signal('project'),
      menuLens: signal('project'),
      previewingMenuLens: signal(false),
      menuPickPending: signal(false),
      clearMenuLensPreview: vi.fn(),
      isHybridPersona: signal(false),
      availableLenses: signal([{ id: 'project' }]),
      setLens: vi.fn(),
    },
  },
  {
    provide: UserService,
    useValue: { user: signal({ user_id: 'u1' } as unknown as User), userInitials: computed(() => 'AL'), effectiveAvatarUrl: computed(() => '') },
  },
  {
    provide: ProjectContextService,
    useValue: { activeContext: signal(null), menuContext: signal(null), activeRouteLensKind: signal('project'), setFoundation: vi.fn(), setProject },
  },
  {
    provide: PersonaService,
    useValue: { isRootWriter: signal(false), personaProjects: signal({}), allPersonas: signal([]), currentPersona: signal('contributor') },
  },
  { provide: NavigationService, useValue: { loaded: vi.fn(() => signal(true)) } },
  { provide: AccountContextService, useValue: { hasOrgSelectorAccess: vi.fn(() => false) } },
];

/**
 * The Project lens landing page is decided per project by `formationOverviewRedirectGuard` (#2754):
 * a formation-stage project lands on its checklist, anything else on the dashboard. A same-lens
 * selector switch normally keeps the page and only rewrites `?project=` via `Location.replaceState`,
 * which never re-runs guards — so on the two pages that decision owns, the switch must re-enter
 * the lens through a real navigation. Class-level, through the test host: its template is
 * empty and `onItemSelected` is reached through a narrow cast.
 */
describe('NavMenuBase — same-lens project switch re-enters the lens landing page (#2754)', () => {
  const navigate = vi.fn();
  const setProject = vi.fn();
  const betaItem: LensItem = { uid: 'uid-beta', slug: 'beta', name: 'Beta', logoUrl: null, isFoundation: false, formationSubStage: null };

  const selectItem = (c: NavMenuTestHostComponent, item: LensItem): void => (c as unknown as { onItemSelected: (i: LensItem) => void }).onItemSelected(item);

  const createNavMenu = async (url: string): Promise<NavMenuTestHostComponent> => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [NavMenuTestHostComponent],
      providers: [
        { provide: Router, useValue: { url, events: EMPTY, navigate, parseUrl: (value: string) => new DefaultUrlSerializer().parse(value) } },
        ...navMenuServiceStubs(setProject),
      ],
    });
    const fixture = TestBed.createComponent(NavMenuTestHostComponent);
    fixture.componentRef.setInput('items', []);
    await fixture.whenStable();
    return fixture.componentInstance;
  };

  beforeEach(() => {
    navigate.mockClear();
    setProject.mockClear();
  });

  it.each(['/project/overview?project=alpha', '/project/formation?project=alpha', '/project/overview#activity'])(
    'navigates to the overview with the new slug when switching projects on %s',
    async (url) => {
      const navMenu = await createNavMenu(url);

      selectItem(navMenu, betaItem);

      expect(setProject).toHaveBeenCalledWith(expect.objectContaining({ slug: 'beta' }), false);
      expect(navigate).toHaveBeenCalledWith(['/project', 'overview'], { queryParams: { project: 'beta' } });
    }
  );

  it('keeps the current page on a same-lens switch elsewhere in the lens, as before', async () => {
    const navMenu = await createNavMenu('/project/meetings?project=alpha');

    selectItem(navMenu, betaItem);

    expect(setProject).toHaveBeenCalledWith(expect.objectContaining({ slug: 'beta' }), true);
    expect(navigate).not.toHaveBeenCalled();
  });
});

/**
 * A pick in the selector of a lens the mobile drawer only previews (#4208): the page underneath belongs to another lens,
 * so the pick commits the picked lens and lands on its overview — it must never re-target the page in place, which would
 * write `?project=` onto a Me or Org page.
 */
describe('NavMenuBase — context picks from a previewed lens (#4208)', () => {
  const navigate = vi.fn();
  const setProject = vi.fn();
  const setFoundation = vi.fn();
  const betaItem: LensItem = { uid: 'uid-beta', slug: 'beta', name: 'Beta', logoUrl: null, isFoundation: false, formationSubStage: null };
  const cncfItem: LensItem = { uid: 'uid-cncf', slug: 'cncf', name: 'CNCF', logoUrl: null, isFoundation: true, formationSubStage: null };

  const selectItem = (c: NavMenuTestHostComponent, item: LensItem): void => (c as unknown as { onItemSelected: (i: LensItem) => void }).onItemSelected(item);
  const queryParamsOf = (c: NavMenuTestHostComponent): { project?: string } =>
    (c as unknown as { projectQueryParams: () => { project?: string } }).projectQueryParams();

  // The rollback a previewed pick hands to commitMenuLens, run by a test as a failed navigation would.
  let restorePick: (() => void) | null = null;
  const selectedProject = signal<ProjectContext | null>({ uid: 'uid-alpha', slug: 'alpha', name: 'Alpha' });

  const createNavMenu = async (url: string, pageLens: Lens, preview: Lens | null, routeKind: 'foundation' | 'project' | null = null, pickPending = false) => {
    const activeLens = signal<Lens>(pageLens);
    const menuLensPreview = signal<Lens | null>(preview);
    const menuLens = computed(() => menuLensPreview() ?? activeLens());
    const lensService = {
      activeLens,
      menuLens,
      previewingMenuLens: computed(() => menuLens() !== activeLens()),
      menuPickPending: signal(pickPending),
      clearMenuLensPreview: vi.fn(() => menuLensPreview.set(null)),
      isHybridPersona: signal(false),
      availableLenses: signal([{ id: 'me' }, { id: 'foundation' }, { id: 'project' }, { id: 'org' }]),
      setLens: vi.fn((lens: Lens) => {
        activeLens.set(lens);
        return true;
      }),
      commitMenuLens: vi.fn((lens: Lens, onRestore?: () => void) => {
        activeLens.set(lens);
        menuLensPreview.set(null);
        restorePick = onRestore ?? null;
      }),
    };
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [NavMenuTestHostComponent],
      providers: [
        { provide: Router, useValue: { url, events: EMPTY, navigate, parseUrl: (value: string) => new DefaultUrlSerializer().parse(value) } },
        ...navMenuServiceStubs(setProject),
        { provide: LensService, useValue: lensService },
        {
          provide: ProjectContextService,
          useValue: {
            activeContext: signal({ uid: 'uid-alpha', slug: 'alpha', name: 'Alpha' }),
            menuContext: signal({ uid: 'uid-alpha', slug: 'alpha', name: 'Alpha' }),
            activeRouteLensKind: signal(routeKind),
            selectedFoundation: signal(null),
            selectedProject,
            setFoundation,
            setProject: vi.fn((ctx: ProjectContext, syncUrl: boolean) => {
              setProject(ctx, syncUrl);
              selectedProject.set(ctx);
            }),
            clearFoundation: vi.fn(),
            clearProject: vi.fn(),
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(NavMenuTestHostComponent);
    fixture.componentRef.setInput('items', []);
    await fixture.whenStable();
    return { navMenu: fixture.componentInstance, lensService };
  };

  beforeEach(() => {
    navigate.mockClear();
    setProject.mockClear();
    setFoundation.mockClear();
    restorePick = null;
    selectedProject.set({ uid: 'uid-alpha', slug: 'alpha', name: 'Alpha' });
  });

  it("clears a slot that was empty before the pick without touching the page's address", async () => {
    selectedProject.set(null);
    const { navMenu } = await createNavMenu('/meetings', 'me', 'project');
    selectItem(navMenu, betaItem);

    restorePick?.();

    expect(TestBed.inject(ProjectContextService).clearProject).toHaveBeenCalledWith(false);
  });

  it('puts the selected project back when the pick never leaves the page, unless another one was selected since', async () => {
    const { navMenu } = await createNavMenu('/meetings', 'me', 'project');
    selectItem(navMenu, betaItem);
    expect(selectedProject()?.slug).toBe('beta');

    restorePick?.();
    expect(selectedProject()?.slug).toBe('alpha');

    const again = await createNavMenu('/meetings', 'me', 'project');
    selectItem(again.navMenu, betaItem);
    selectedProject.set({ uid: 'uid-gamma', slug: 'gamma', name: 'Gamma' });
    restorePick?.();
    expect(selectedProject()?.slug).toBe('gamma');
  });

  it("lands a project picked in the previewed Projects lens on its overview from a Me page, without touching the Me page's address", async () => {
    const { navMenu, lensService } = await createNavMenu('/meetings', 'me', 'project');

    selectItem(navMenu, betaItem);

    // Committed like any pick from the previewed menu, so a navigation that never leaves the page is undone.
    expect(lensService.commitMenuLens).toHaveBeenCalledWith('project', expect.any(Function));
    expect(lensService.setLens).not.toHaveBeenCalled();
    expect(lensService.previewingMenuLens()).toBe(false);
    expect(setProject).toHaveBeenCalledWith(expect.objectContaining({ slug: 'beta' }), false);
    expect(navigate).toHaveBeenCalledWith(['/project', 'overview'], { queryParams: { project: 'beta' } });
  });

  it('lands a foundation picked in the previewed Foundation lens on its overview from an Org page', async () => {
    const { navMenu, lensService } = await createNavMenu('/org/acme/overview', 'org', 'foundation');

    selectItem(navMenu, cncfItem);

    expect(lensService.commitMenuLens).toHaveBeenCalledWith('foundation', expect.any(Function));
    expect(lensService.activeLens()).toBe('foundation');
    expect(setFoundation).toHaveBeenCalledWith(expect.objectContaining({ slug: 'cncf' }), false);
    expect(setProject).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(['/foundation', 'overview'], { queryParams: { project: 'cncf' } });
  });

  it('keeps re-targeting a flat page in place for a pick made without a preview, as before', async () => {
    const { navMenu } = await createNavMenu('/meetings', 'project', null);

    selectItem(navMenu, betaItem);

    expect(setProject).toHaveBeenCalledWith(expect.objectContaining({ slug: 'beta' }), true);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("carries ?project= on a previewed lens's links by that lens, not by the page underneath", async () => {
    expect(queryParamsOf((await createNavMenu('/foundation/meetings', 'foundation', null, 'foundation')).navMenu)).toEqual({ project: 'alpha' });
    // A Me menu previewed over a foundation page carries no slug…
    expect(queryParamsOf((await createNavMenu('/foundation/meetings', 'foundation', 'me', 'foundation')).navMenu)).toEqual({});
    // …and a Projects menu previewed over a Me page carries its selector's.
    expect(queryParamsOf((await createNavMenu('/meetings', 'me', 'project')).navMenu)).toEqual({ project: 'alpha' });
    // A Home pick still navigating off a foundation page: its links still carry no slug, though the route hasn't moved.
    expect(queryParamsOf((await createNavMenu('/foundation/overview', 'me', null, 'foundation', true)).navMenu)).toEqual({});
  });
});

describe('NavMenuBase — link-active options (#3358)', () => {
  @Component({ selector: 'lfx-blank-page', template: '' })
  class BlankPageStubComponent {}

  const peopleLink = '/org/acme-inc/people';
  const easyclaLink = '/org/acme-inc/easycla';
  const legacyEasyclaLink = '/org/easycla';
  const items: SidebarMenuItem[] = [
    { label: 'People', routerLink: peopleLink },
    {
      label: 'EasyCLA Management',
      isSection: true,
      items: [{ label: 'EasyCLA', routerLink: easyclaLink, activeOnSubpaths: true, activeAliases: [legacyEasyclaLink] }],
    },
  ];

  let router: Router;
  let component: NavMenuTestHostComponent;
  let decorated: ReturnType<NavMenuTestHostComponent['itemsWithTestIds']>;

  beforeEach(async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [NavMenuTestHostComponent],
      providers: [provideRouter([{ path: '**', component: BlankPageStubComponent }]), ...navMenuServiceStubs()],
    });
    const fixture = TestBed.createComponent(NavMenuTestHostComponent);
    fixture.componentRef.setInput('items', items);
    await fixture.whenStable();
    router = TestBed.inject(Router);
    component = fixture.componentInstance;
    decorated = component['itemsWithTestIds']();
  });

  const peopleOptions = (): IsActiveMatchOptions => decorated[0].activeMatchOptions;
  const easyclaOptions = (): IsActiveMatchOptions | undefined => decorated[1].items?.[0]?.activeMatchOptions;
  const isActive = (link: string, options: IsActiveMatchOptions | undefined): boolean => !!options && router.isActive(link, options);
  const highlightedByAlias = (item: { trackKey: string } | undefined): boolean => !!item && !!component['aliasHighlightedKeys']()[item.trackKey];

  it('matches exact paths by default and subpaths only for an item that opts in, at any depth', () => {
    expect(peopleOptions()).toEqual({ paths: 'exact', queryParams: 'ignored', matrixParams: 'ignored', fragment: 'ignored' });
    expect(easyclaOptions()).toEqual({ paths: 'subset', queryParams: 'ignored', matrixParams: 'ignored', fragment: 'ignored' });
  });

  it('highlights the opted-in item on its own page and on a detail page carrying a query string', async () => {
    await router.navigateByUrl(easyclaLink);
    expect(isActive(easyclaLink, easyclaOptions())).toBe(true);

    await router.navigateByUrl(`${easyclaLink}/cla-group-1?signingEntity=entity-1`);
    expect(isActive(easyclaLink, easyclaOptions())).toBe(true);
  });

  it('does not highlight the opted-in item on a sibling page that only shares a prefix', async () => {
    await router.navigateByUrl(`${easyclaLink}-other`);

    expect(isActive(easyclaLink, easyclaOptions())).toBe(false);
  });

  it('keeps an item that did not opt in unhighlighted below its own page', async () => {
    await router.navigateByUrl(`${peopleLink}/person-1`);
    expect(isActive(peopleLink, peopleOptions())).toBe(false);

    await router.navigateByUrl(peopleLink);
    expect(isActive(peopleLink, peopleOptions())).toBe(true);
  });

  it('highlights an aliased item on a detail page under its alias, as a leftover signing return leaves it', async () => {
    await router.navigateByUrl(`${legacyEasyclaLink}/cla-group-1?org=org-1`);

    expect(highlightedByAlias(decorated[1].items?.[0])).toBe(true);
  });

  it('still highlights an aliased item under its own link', async () => {
    await router.navigateByUrl(`${easyclaLink}/cla-group-1`);

    expect(highlightedByAlias(decorated[1].items?.[0])).toBe(true);
  });

  it('does not highlight an aliased item on a sibling page that only shares the alias prefix', async () => {
    await router.navigateByUrl(`${legacyEasyclaLink}-other`);

    expect(highlightedByAlias(decorated[1].items?.[0])).toBe(false);
  });

  it('leaves an item without aliases to exact routerLinkActive matching', async () => {
    await router.navigateByUrl(peopleLink);
    expect(highlightedByAlias(decorated[0])).toBe(false);
    expect(isActive(peopleLink, peopleOptions())).toBe(true);

    await router.navigateByUrl(`${peopleLink}/person-1`);
    expect(highlightedByAlias(decorated[0])).toBe(false);
    expect(isActive(peopleLink, peopleOptions())).toBe(false);
  });
});

/**
 * The Org Lens range carries between People and Code Contributions (lfx-self-serve#4159): their links copy `?range=` from a
 * page that is one of them, and nothing else from it, while other pages' params never leak into those links.
 */
describe('NavMenuBase — carried query params', () => {
  @Component({ selector: 'lfx-carry-blank-page', template: '' })
  class CarryBlankPageStubComponent {}

  const items: SidebarMenuItem[] = [
    { label: 'Projects', routerLink: '/org/acme-inc/projects' },
    {
      label: 'Organization Engagement',
      isSection: true,
      items: [
        { label: 'People', routerLink: '/org/acme-inc/people', carryQueryParams: ['range'] },
        { label: 'Code Contributions', routerLink: '/org/acme-inc/contributions', carryQueryParams: ['range'] },
      ],
    },
  ];

  let router: Router;
  let component: NavMenuTestHostComponent;

  /** Query params each link renders with, by label (absent = the plain project params). */
  const linkParams = (): Record<string, unknown> => {
    const carried = component['carriedQueryParams']();
    const section = component['itemsWithTestIds']()[1].items ?? [];
    return Object.fromEntries(section.map((item) => [item.label, carried[item.trackKey]]));
  };

  beforeEach(async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [NavMenuTestHostComponent],
      providers: [provideRouter([{ path: '**', component: CarryBlankPageStubComponent }]), ...navMenuServiceStubs()],
    });
    const fixture = TestBed.createComponent(NavMenuTestHostComponent);
    fixture.componentRef.setInput('items', items);
    await fixture.whenStable();
    router = TestBed.inject(Router);
    component = fixture.componentInstance;
  });

  it('carries only the range from a People tab to Code Contributions and back', async () => {
    await router.navigateByUrl('/org/acme-inc/people?tab=contributors&range=90d&projectScope=lf');
    expect(linkParams()).toEqual({ People: { range: '90d' }, 'Code Contributions': { range: '90d' } });

    await router.navigateByUrl('/org/acme-inc/contributions?range=all&view=commits&projects=k8s');
    expect(linkParams()).toEqual({ People: { range: 'all' }, 'Code Contributions': { range: 'all' } });
  });

  it('follows a range picked on the page', async () => {
    await router.navigateByUrl('/org/acme-inc/people?tab=training');
    expect(linkParams()).toEqual({ People: undefined, 'Code Contributions': undefined });

    await router.navigateByUrl('/org/acme-inc/people?tab=training&range=30d');
    expect(linkParams()['Code Contributions']).toEqual({ range: '30d' });

    await router.navigateByUrl('/org/acme-inc/people?tab=training&range=365d');
    expect(linkParams()).toEqual({ People: { range: '365d' }, 'Code Contributions': { range: '365d' } });
  });

  it.each(['2y', '730d'])('carries no ?range=%s, which is unknown or the default', async (range) => {
    await router.navigateByUrl(`/org/acme-inc/contributions?range=${range}`);

    expect(linkParams()).toEqual({ People: undefined, 'Code Contributions': undefined });
  });

  it('carries a legacy ?range=12mo as Past 365 days, the window the BFF reads it as', async () => {
    await router.navigateByUrl('/org/acme-inc/contributions?range=12mo');

    expect(linkParams()['People']).toEqual({ range: '365d' });
  });

  it('carries nothing from a page that does not carry the range', async () => {
    await router.navigateByUrl('/org/acme-inc/projects?range=2y');

    expect(linkParams()).toEqual({ People: undefined, 'Code Contributions': undefined });
  });
});

/**
 * The Org Lens organization scope (lfx-self-serve-ops#1219) carries between the pages that count contributors and
 * Projects, including from a project detail page under Projects, so a pick of All related organizations survives the sidebar.
 */
describe('NavMenuBase — carried organization scope', () => {
  @Component({ selector: 'lfx-carry-scope-blank-page', template: '' })
  class CarryScopeBlankPageStubComponent {}

  const items: SidebarMenuItem[] = [
    { label: 'Dashboard', routerLink: '/org/acme-inc/overview', carryQueryParams: ['orgScope'] },
    { label: 'Memberships', routerLink: '/org/acme-inc/memberships' },
    { label: 'Projects', routerLink: '/org/acme-inc/projects', carryQueryParams: ['orgScope'] },
    {
      label: 'Organization Engagement',
      isSection: true,
      items: [
        { label: 'People', routerLink: '/org/acme-inc/people', carryQueryParams: ['range', 'orgScope'] },
        { label: 'Code Contributions', routerLink: '/org/acme-inc/contributions', carryQueryParams: ['range', 'orgScope'] },
      ],
    },
  ];

  let router: Router;
  let component: NavMenuTestHostComponent;

  /** Query params each link renders with, by label (absent = the plain project params). */
  const linkParams = (): Record<string, unknown> => {
    const carried = component['carriedQueryParams']();
    const links = component['itemsWithTestIds']().flatMap((item) => (item.isSection ? (item.items ?? []) : [item]));
    return Object.fromEntries(links.map((item) => [item.label, carried[item.trackKey]]));
  };

  beforeEach(async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [NavMenuTestHostComponent],
      providers: [provideRouter([{ path: '**', component: CarryScopeBlankPageStubComponent }]), ...navMenuServiceStubs()],
    });
    const fixture = TestBed.createComponent(NavMenuTestHostComponent);
    fixture.componentRef.setInput('items', items);
    await fixture.whenStable();
    router = TestBed.inject(Router);
    component = fixture.componentInstance;
  });

  it('carries ?orgScope=all from People to Dashboard, Projects and Code Contributions, the range only between People and Code Contributions', async () => {
    await router.navigateByUrl('/org/acme-inc/people?tab=contributors&range=90d&orgScope=all');

    expect(linkParams()).toEqual({
      Dashboard: { orgScope: 'all' },
      Memberships: undefined,
      Projects: { orgScope: 'all' },
      People: { range: '90d', orgScope: 'all' },
      'Code Contributions': { range: '90d', orgScope: 'all' },
    });
  });

  it('carries ?orgScope=all from a project detail page under Projects, but not its own range', async () => {
    await router.navigateByUrl('/org/acme-inc/projects/kubernetes?orgScope=all&range=1y');

    expect(linkParams()).toEqual({
      Dashboard: { orgScope: 'all' },
      Memberships: undefined,
      Projects: { orgScope: 'all' },
      People: { orgScope: 'all' },
      'Code Contributions': { orgScope: 'all' },
    });
  });

  it.each(['insights', 'bogus'])('carries no ?orgScope=%s, which is the default or unknown', async (orgScope) => {
    await router.navigateByUrl(`/org/acme-inc/overview?orgScope=${orgScope}`);

    expect(linkParams()).toEqual({ Dashboard: undefined, Memberships: undefined, Projects: undefined, People: undefined, 'Code Contributions': undefined });
  });

  it('carries nothing from a page that carries no organization scope', async () => {
    await router.navigateByUrl('/org/acme-inc/memberships?orgScope=all');

    expect(linkParams()).toEqual({ Dashboard: undefined, Memberships: undefined, Projects: undefined, People: undefined, 'Code Contributions': undefined });
  });
});
