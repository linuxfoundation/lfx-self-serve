// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { LENS_COOKIE_KEY, NAV_LENS_COOKIE_KEY } from '@lfx-one/shared/constants';
import { Lens, NavLens } from '@lfx-one/shared/interfaces';
import { SsrCookieService } from 'ngx-cookie-service-ssr';
import { describe, expect, it, vi } from 'vitest';

import { CookieRegistryService } from './cookie-registry.service';
import { FeatureFlagService } from './feature-flag.service';
import { LensService } from './lens.service';
import { PersonaService } from './persona.service';
import { WriterGrantsService } from './writer-grants.service';

/**
 * The mobile nav drawer's lens tabs preview another lens's menu (#4208). The preview lives in `menuLens`, apart from
 * `activeLens`: the page underneath renders from `activeLens`, so it must not move until a pick commits the preview.
 */
describe('LensService — menu lens preview', () => {
  function setup(storedLens: Lens, { hasBoardRole = false, hasProjectRole = true, storedNavLens = 'project' as NavLens } = {}) {
    const boardRole = signal(hasBoardRole);
    const projectRole = signal(hasProjectRole);
    const cookies = {
      get: vi.fn((key: string) => {
        if (key === LENS_COOKIE_KEY) return storedLens;
        return key === NAV_LENS_COOKIE_KEY ? storedNavLens : '';
      }),
      set: vi.fn(),
    };
    const navigate = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        LensService,
        { provide: SsrCookieService, useValue: cookies },
        { provide: CookieRegistryService, useValue: { registerCookie: vi.fn() } },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: () => signal(false) } },
        { provide: Router, useValue: { navigate } },
        {
          provide: PersonaService,
          useValue: {
            hasBoardRole: boardRole,
            hasProjectRole: projectRole,
            isRootWriter: signal(false),
            isLFStaff: signal(false),
            isMarketingAuditor: signal(false),
            isCampaignManager: signal(false),
            isAuditor: signal(false),
          },
        },
        { provide: WriterGrantsService, useValue: { hasWriterFoundation: signal(false), hasWriterProject: signal(false) } },
      ],
    });
    const lens = TestBed.inject(LensService);
    return { lens, cookies, navigate, boardRole, projectRole };
  }

  it('previews a lens menu without moving the active lens, persisting it or navigating', () => {
    const { lens, cookies, navigate } = setup('me');
    // Stands in for the page underneath: anything computed from activeLens must not recompute for a preview.
    let pageRenders = 0;
    const page = computed(() => {
      pageRenders += 1;
      return lens.activeLens();
    });
    expect(page()).toBe('me');

    lens.previewMenuLens('project');

    expect(lens.menuLens()).toBe('project');
    expect(lens.displayMenuLens()).toBe('project');
    expect(lens.previewingMenuLens()).toBe(true);
    expect(page()).toBe('me');
    expect(pageRenders).toBe(1);
    expect(cookies.set).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('drops a preview on clear, leaving the page lens exactly as it was', () => {
    const { lens, cookies } = setup('me');
    lens.previewMenuLens('org');

    lens.clearMenuLensPreview();

    expect(lens.menuLens()).toBe('me');
    expect(lens.previewingMenuLens()).toBe(false);
    expect(lens.activeLens()).toBe('me');
    expect(cookies.set).not.toHaveBeenCalled();
  });

  it('commits a preview as the active lens for a pick, without navigating itself', () => {
    const { lens, cookies, navigate } = setup('me');
    lens.previewMenuLens('project');

    lens.commitMenuLens();

    expect(lens.activeLens()).toBe('project');
    expect(lens.menuLens()).toBe('project');
    expect(lens.previewingMenuLens()).toBe(false);
    expect(cookies.set).toHaveBeenCalledWith(LENS_COOKIE_KEY, 'project', expect.any(Object));
    expect(navigate).not.toHaveBeenCalled();
  });

  it('commits nothing without a preview', () => {
    const { lens, cookies } = setup('me');

    lens.commitMenuLens();

    expect(lens.activeLens()).toBe('me');
    expect(cookies.set).not.toHaveBeenCalled();
  });

  it("ends the preview on the page's own lens, and ignores a lens the persona may not use", () => {
    const { lens } = setup('me');
    lens.previewMenuLens('project');

    lens.previewMenuLens('me');
    expect(lens.previewingMenuLens()).toBe(false);

    lens.previewMenuLens('foundation');
    expect(lens.menuLens()).toBe('me');
    expect(lens.previewingMenuLens()).toBe(false);
  });

  it("resolves a hybrid persona's merged Projects tab to the last viewed nav lens, like switchLens", () => {
    const { lens } = setup('me', { hasBoardRole: true, storedNavLens: 'foundation' });

    lens.previewMenuLens('project');

    expect(lens.menuLens()).toBe('foundation');
    expect(lens.displayMenuLens()).toBe('project');
  });

  it('leaves a route-driven lens change to the route: clearing the preview never restores an older lens', () => {
    const { lens } = setup('me', { hasBoardRole: true });
    lens.previewMenuLens('org');

    // A navigation (or delayed grants re-asserting the route lens) lands while the drawer previews another lens.
    lens.setLens('foundation');
    expect(lens.menuLens()).toBe('org');

    lens.clearMenuLensPreview();
    expect(lens.activeLens()).toBe('foundation');
    expect(lens.menuLens()).toBe('foundation');
  });

  it('falls back to the active lens if the previewed lens stops being allowed', () => {
    const { lens, projectRole } = setup('me');
    lens.previewMenuLens('project');

    projectRole.set(false);

    expect(lens.menuLens()).toBe('me');
    expect(lens.previewingMenuLens()).toBe(false);
  });
});
