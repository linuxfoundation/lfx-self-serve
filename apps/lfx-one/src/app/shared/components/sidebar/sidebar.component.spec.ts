// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DefaultUrlSerializer, Router } from '@angular/router';
import { LensItem, User } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { FeatureFlagService } from '@services/feature-flag.service';
import { LensService } from '@services/lens.service';
import { NavigationService } from '@services/navigation.service';
import { PersonaService } from '@services/persona.service';
import { ProjectContextService } from '@services/project-context.service';
import { UserService } from '@services/user.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SidebarComponent } from './sidebar.component';

/**
 * The Project lens landing page is decided per project by `formationOverviewRedirectGuard` (#2754):
 * a formation-stage project lands on its checklist, anything else on the dashboard. A same-lens
 * selector switch normally keeps the page and only rewrites `?project=` via `Location.replaceState`,
 * which never re-runs guards — so on the two pages that decision owns, the switch must re-enter
 * the lens through a real navigation. Class-level, like the suite above: the template is overridden
 * empty and `onItemSelected` is reached through a narrow cast.
 */
describe('SidebarComponent — same-lens project switch re-enters the lens landing page (#2754)', () => {
  const navigate = vi.fn();
  const setProject = vi.fn();
  const betaItem: LensItem = { uid: 'uid-beta', slug: 'beta', name: 'Beta', logoUrl: null, isFoundation: false, formationSubStage: null };

  const selectItem = (c: SidebarComponent, item: LensItem): void => (c as unknown as { onItemSelected: (i: LensItem) => void }).onItemSelected(item);

  const createSidebar = async (url: string): Promise<SidebarComponent> => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [SidebarComponent],
      providers: [
        { provide: Router, useValue: { url, navigate, parseUrl: (value: string) => new DefaultUrlSerializer().parse(value) } },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: vi.fn(() => signal(false)) } },
        {
          provide: LensService,
          useValue: { activeLens: signal('project'), isHybridPersona: signal(false), availableLenses: signal([{ id: 'project' }]), setLens: vi.fn() },
        },
        {
          provide: UserService,
          useValue: { user: signal({ user_id: 'u1' } as unknown as User), userInitials: computed(() => 'AL'), effectiveAvatarUrl: computed(() => '') },
        },
        {
          provide: ProjectContextService,
          useValue: { activeContext: signal(null), activeRouteLensKind: signal('project'), setFoundation: vi.fn(), setProject },
        },
        {
          provide: PersonaService,
          useValue: { isRootWriter: signal(false), personaProjects: signal({}), allPersonas: signal([]), currentPersona: signal('contributor') },
        },
        { provide: NavigationService, useValue: { loaded: vi.fn(() => signal(true)) } },
        { provide: AccountContextService, useValue: { hasOrgSelectorAccess: vi.fn(() => false) } },
      ],
    });
    TestBed.overrideComponent(SidebarComponent, { set: { template: '', imports: [], providers: [] } });
    const fixture = TestBed.createComponent(SidebarComponent);
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
      const sidebar = await createSidebar(url);

      selectItem(sidebar, betaItem);

      expect(setProject).toHaveBeenCalledWith(expect.objectContaining({ slug: 'beta' }), false);
      expect(navigate).toHaveBeenCalledWith(['/project', 'overview'], { queryParams: { project: 'beta' } });
    }
  );

  it('keeps the current page on a same-lens switch elsewhere in the lens, as before', async () => {
    const sidebar = await createSidebar('/project/meetings?project=alpha');

    selectItem(sidebar, betaItem);

    expect(setProject).toHaveBeenCalledWith(expect.objectContaining({ slug: 'beta' }), true);
    expect(navigate).not.toHaveBeenCalled();
  });
});
