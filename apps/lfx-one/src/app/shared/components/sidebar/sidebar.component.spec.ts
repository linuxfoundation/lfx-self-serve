// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { OPEN_PROFILE_BANNER_LINK_CLICKED } from '@lfx-one/shared/constants';
import { User } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { DataDogRumService } from '@services/datadog-rum.service';
import { FeatureFlagService } from '@services/feature-flag.service';
import { LensService } from '@services/lens.service';
import { NavigationService } from '@services/navigation.service';
import { PersonaService } from '@services/persona.service';
import { ProjectContextService } from '@services/project-context.service';
import { UserService } from '@services/user.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SidebarComponent } from './sidebar.component';

/**
 * Pins the "Still need Open Profile?" link click-tracking (LFXV2-3336): a rename or a dropped
 * call here breaks the click count silently, since the click itself still "works" (Intercom opens
 * via the lfxOpenIntercom directive regardless). The template is overridden empty so the class
 * logic runs without instantiating the selector/lens-tab children and their service graph.
 */
describe('SidebarComponent — Open Profile banner (LFXV2-3336)', () => {
  const addAction = vi.fn();
  let fixture: ComponentFixture<SidebarComponent>;

  // `trackOpenProfileBannerClick` is protected; reach it through a narrow cast rather than
  // clicking through the overridden (empty) template.
  const clickBannerLink = (c: SidebarComponent): void => (c as unknown as { trackOpenProfileBannerClick: () => void }).trackOpenProfileBannerClick();

  beforeEach(async () => {
    addAction.mockClear();
    TestBed.resetTestingModule();

    TestBed.configureTestingModule({
      imports: [SidebarComponent],
      providers: [
        { provide: Router, useValue: { url: '/', navigate: vi.fn() } },
        { provide: DataDogRumService, useValue: { addAction } },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: vi.fn(() => signal(false)) } },
        {
          provide: LensService,
          useValue: { activeLens: signal('me'), isHybridPersona: signal(false), availableLenses: signal([]), setLens: vi.fn() },
        },
        {
          provide: UserService,
          useValue: { user: signal({ user_id: 'u1' } as unknown as User), userInitials: computed(() => 'AL'), effectiveAvatarUrl: computed(() => '') },
        },
        {
          provide: ProjectContextService,
          useValue: { activeContext: signal(null), activeRouteLensKind: signal('me'), setFoundation: vi.fn(), setProject: vi.fn() },
        },
        {
          provide: PersonaService,
          useValue: { isRootWriter: signal(false), personaProjects: signal({}), allPersonas: signal([]), currentPersona: signal('contributor') },
        },
        { provide: NavigationService, useValue: { loaded: vi.fn(() => signal(true)) } },
        { provide: AccountContextService, useValue: { hasOrgSelectorAccess: vi.fn(() => false) } },
      ],
    });
    // Empty template + no component providers: exercises the class without rendering the child components.
    TestBed.overrideComponent(SidebarComponent, { set: { template: '', imports: [], providers: [] } });

    fixture = TestBed.createComponent(SidebarComponent);
    fixture.componentRef.setInput('items', []);
    await fixture.whenStable();
  });

  it('emits the banner click action with no context payload', () => {
    clickBannerLink(fixture.componentInstance);

    expect(addAction).toHaveBeenCalledWith(OPEN_PROFILE_BANNER_LINK_CLICKED);
  });
});
