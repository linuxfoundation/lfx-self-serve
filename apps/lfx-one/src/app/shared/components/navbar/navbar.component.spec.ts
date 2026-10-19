// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, signal } from '@angular/core';
import type { Signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DefaultUrlSerializer, Router } from '@angular/router';
import { ALL_LENSES, NAVBAR_ROLE_STYLES } from '@lfx-one/shared/constants';
import type { Lens, LensOption, NavbarMenuBlock, NavbarRoleMark, PersonaProject, PersonaType, SidebarMenuItem, User } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { ChangelogService } from '@services/changelog.service';
import { CreatePermissionService } from '@services/create-permission.service';
import { FeatureFlagService } from '@services/feature-flag.service';
import { LensService } from '@services/lens.service';
import { NavigationService } from '@services/navigation.service';
import { PersonaService } from '@services/persona.service';
import { ProjectContextService } from '@services/project-context.service';
import { SidebarNavService } from '@services/sidebar-nav.service';
import { UserService } from '@services/user.service';
import { DialogService } from 'primeng/dynamicdialog';
import { EMPTY } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { NavbarComponent } from './navbar.component';

/** The navbar's protected view state, reached through a narrow cast (template is overridden empty). */
interface NavbarView {
  menuBlocks: Signal<NavbarMenuBlock<SidebarMenuItem & { trackKey: string }>[]>;
  lensTabs: Signal<LensOption[]>;
  roleMarks: Signal<NavbarRoleMark[]>;
  showNoAccessState: Signal<'foundation' | 'project' | null>;
  menuPending: Signal<boolean>;
}

const createNavbar = async (
  items: SidebarMenuItem[],
  personas: PersonaType[] = [],
  personaProjects: Partial<Record<PersonaType, PersonaProject[]>> = {},
  { lens = 'me', itemsPending = false }: { lens?: Lens; itemsPending?: boolean } = {}
): Promise<NavbarView> => {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [NavbarComponent],
    providers: [
      { provide: Router, useValue: { url: '/', events: EMPTY, navigate: vi.fn(), parseUrl: (value: string) => new DefaultUrlSerializer().parse(value) } },
      { provide: FeatureFlagService, useValue: { getBooleanFlag: vi.fn(() => signal(false)) } },
      {
        provide: LensService,
        useValue: {
          activeLens: signal(lens),
          isHybridPersona: signal(false),
          availableLenses: signal([ALL_LENSES.me, ALL_LENSES.project]),
          displayLenses: signal([ALL_LENSES.me, ALL_LENSES.project]),
          displayActiveLens: signal(lens),
          setLens: vi.fn(),
          switchLens: vi.fn(),
        },
      },
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
      { provide: ProjectContextService, useValue: { activeContext: signal(null), activeRouteLensKind: signal(null) } },
      {
        provide: PersonaService,
        useValue: {
          isRootWriter: signal(false),
          personaProjects: signal(personaProjects),
          detectedProjects: signal([{ projectUid: 'uid-k8s', isFoundation: false }]),
          allPersonas: signal(personas),
          currentPersona: signal('contributor'),
        },
      },
      { provide: NavigationService, useValue: { loaded: vi.fn(() => signal(true)) } },
      { provide: AccountContextService, useValue: { hasOrgSelectorAccess: vi.fn(() => false) } },
      { provide: ChangelogService, useValue: { unseenChangelogCount: signal(0), loadUnseenCount: vi.fn() } },
      { provide: DialogService, useValue: { open: vi.fn() } },
      { provide: SidebarNavService, useValue: { sidebarItemsPending: signal(itemsPending) } },
      { provide: CreatePermissionService, useValue: { canShowCreateButton: signal(false), creatableTypes: signal([]) } },
    ],
  });
  TestBed.overrideComponent(NavbarComponent, { set: { template: '', imports: [], providers: [] } });
  const fixture = TestBed.createComponent(NavbarComponent);
  fixture.componentRef.setInput('items', items);
  await fixture.whenStable();
  return fixture.componentInstance as unknown as NavbarView;
};

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
});
