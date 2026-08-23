// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { AppService } from '@services/app.service';
import { GroupService } from '@services/group.service';
import { LensService } from '@services/lens.service';
import { ProjectService } from '@services/project.service';
import { UserService } from '@services/user.service';
import { of } from 'rxjs';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { PublicGroupDirectoryResponse, PublicGroupSummary } from '@lfx-one/shared/interfaces';

import { PublicFoundationGroupsComponent } from './public-foundation-groups.component';

// jsdom doesn't implement matchMedia; PrimeNG's Menubar (rendered inside <lfx-header/>) calls it
// on init to bind a responsive listener.
beforeAll(() => {
  window.matchMedia ??= ((query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }) as unknown as MediaQueryList) as typeof window.matchMedia;
});

function group(over: Partial<PublicGroupSummary> = {}): PublicGroupSummary {
  return {
    uid: 'g1',
    name: 'WG Identity & Trust',
    category: 'Working Group',
    behavioral_class: 'working-group',
    context: {
      scope: 'foundation',
      foundation_uid: 'f1',
      foundation_name: 'Ultra Ethernet Consortium Fund',
      foundation_slug: 'uepf',
    },
    ...over,
  };
}

describe('PublicFoundationGroupsComponent — contrast and responsive row layout (GH-1791)', () => {
  let fixture: ComponentFixture<PublicFoundationGroupsComponent>;

  async function render(response: PublicGroupDirectoryResponse, slug = 'uepf'): Promise<void> {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [PublicFoundationGroupsComponent],
      providers: [
        { provide: GroupService, useValue: { getPublicFoundationGroups: () => of(response) } },
        { provide: ActivatedRoute, useValue: { paramMap: of(new Map([['foundationSlug', slug]])) } },
        // <lfx-header/> deps — mocked directly rather than resolving the real LensService ->
        // PersonaService -> AccountContextService chain, which needs far more than HttpClient.
        { provide: UserService, useValue: { authenticated: signal(false), getCurrentUserProfile: vi.fn(() => of(null)) } },
        { provide: LensService, useValue: { setLens: vi.fn() } },
        { provide: ProjectService, useValue: { searchProjects: vi.fn(() => of([])) } },
        { provide: AppService, useValue: { toggleMobileSidebar: vi.fn() } },
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PublicFoundationGroupsComponent);
    await fixture.whenStable();
  }

  it('renders the row project-name line with passing gray-500 contrast, not gray-400', async () => {
    await render({
      groups: [
        group({
          context: {
            scope: 'foundation',
            foundation_uid: 'f1',
            foundation_name: 'UEPF',
            foundation_slug: 'uepf',
            project_name: 'Cloud Native Computing Foundation',
          },
        }),
      ],
      total: 1,
    });

    const line = fixture.nativeElement.querySelector('[data-testid="public-foundation-groups-item-project"]');
    expect(line).not.toBeNull();
    expect(line?.textContent?.trim()).toBe('Cloud Native Computing Foundation');
    expect(line?.className).toContain('text-gray-500');
    expect(line?.className).not.toContain('text-gray-400');
  });

  it('behavioral class chip has no hidden class at any breakpoint, and keeps its explicit flex + shrink-0', async () => {
    // `flex` and `shrink-0` are asserted, not just the absence of `hidden`, because a "drop
    // redundant class" pass could silently regress both without failing any other assertion here:
    // without `flex` the host still renders (it blockifies to `block` as a flex item either way) —
    // only the strut-height fix `flex` provides would quietly come back. Without `shrink-0` the
    // chip would default to flex-shrink: 1 once `sm:contents` folds the wrapper away at `sm+`,
    // letting it get squeezed instead of keeping its natural width.
    await render({ groups: [group()], total: 1 });

    const chip = fixture.nativeElement.querySelector('[data-testid="public-foundation-groups-item-class-chip"]');
    expect(chip).not.toBeNull();
    const chipClasses = (chip?.getAttribute('class') ?? '').split(/\s+/);
    expect(chipClasses.some((c: string) => c === 'hidden' || c.endsWith(':hidden'))).toBe(false);
    expect(chipClasses).toContain('flex');
    expect(chipClasses).toContain('shrink-0');
  });

  it('meta wrapper folds to display:contents at sm+, while both wrapper and inner block keep their own growing flex classes', async () => {
    // Regression lock: the wrapper's own flex-1/min-w-0 are load-bearing below `sm`, where it is
    // still a real flex item of the row and min-w-0 is what lets the truncate'd name/description
    // actually truncate. At sm+, `display: contents` gives the wrapper no box of its own, so those
    // classes go inert there — which is why the inner meta block must carry its own copies too, or
    // the block would collapse to content width once the wrapper stops applying them.
    await render({ groups: [group()], total: 1 });

    const wrapper = fixture.nativeElement.querySelector('[data-testid="public-foundation-groups-item-meta-wrapper"]');
    const block = fixture.nativeElement.querySelector('[data-testid="public-foundation-groups-item-meta-block"]');

    expect(wrapper).not.toBeNull();
    expect(block).not.toBeNull();
    expect(wrapper?.contains(block)).toBe(true);
    expect(wrapper?.className).toContain('sm:contents');

    const wrapperClasses = (wrapper?.className ?? '').split(/\s+/);
    expect(wrapperClasses).toContain('flex-1');
    expect(wrapperClasses).toContain('min-w-0');

    const blockClasses = (block?.className ?? '').split(/\s+/);
    expect(blockClasses).toContain('flex-1');
    expect(blockClasses).toContain('min-w-0');
  });
});
