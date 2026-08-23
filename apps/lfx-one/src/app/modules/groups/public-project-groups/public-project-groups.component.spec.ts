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

import { PublicProjectGroupsComponent } from './public-project-groups.component';

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
      scope: 'project',
      foundation_uid: 'f1',
      foundation_name: 'Cloud Native Computing Foundation',
      foundation_slug: 'cncf',
      project_uid: 'p1',
      project_name: 'Kubernetes',
      project_slug: 'kubernetes',
    },
    ...over,
  };
}

describe('PublicProjectGroupsComponent — contrast and responsive row layout (GH-1791)', () => {
  let fixture: ComponentFixture<PublicProjectGroupsComponent>;

  async function render(response: PublicGroupDirectoryResponse, slug = 'kubernetes'): Promise<void> {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [PublicProjectGroupsComponent],
      providers: [
        { provide: GroupService, useValue: { getPublicProjectGroups: () => of(response) } },
        { provide: ActivatedRoute, useValue: { paramMap: of(new Map([['projectSlug', slug]])) } },
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

    fixture = TestBed.createComponent(PublicProjectGroupsComponent);
    await fixture.whenStable();
  }

  it('renders the header foundation-name line with passing gray-500 contrast, not gray-400', async () => {
    await render({ groups: [group()], total: 1 });

    const line = fixture.nativeElement.querySelector('[data-testid="public-project-groups-foundation"]');
    expect(line).not.toBeNull();
    expect(line?.textContent?.trim()).toBe('Cloud Native Computing Foundation');
    expect(line?.className).toContain('text-gray-500');
    expect(line?.className).not.toContain('text-gray-400');
  });

  it('behavioral class chip has no hidden class at any breakpoint', async () => {
    await render({ groups: [group()], total: 1 });

    const chip = fixture.nativeElement.querySelector('[data-testid="public-project-groups-item-class-chip"]');
    expect(chip).not.toBeNull();
    const chipClasses = (chip?.getAttribute('class') ?? '').split(/\s+/);
    expect(chipClasses.some((c: string) => c === 'hidden' || c.endsWith(':hidden'))).toBe(false);
    expect(chipClasses).toContain('flex');
    expect(chipClasses).toContain('shrink-0');
  });

  it('meta wrapper folds to display:contents at sm+, while the inner meta block keeps the growing flex class', async () => {
    // Regression lock, mirroring org-groups.component.spec.ts (PR #1789): flex-1/min-w-0 must live
    // on the inner meta block, not the sm:contents wrapper — display:contents gives the wrapper no
    // box of its own at sm+, so flex classes placed there would silently stop applying.
    await render({ groups: [group()], total: 1 });

    const wrapper = fixture.nativeElement.querySelector('[data-testid="public-project-groups-item-meta-wrapper"]');
    const block = fixture.nativeElement.querySelector('[data-testid="public-project-groups-item-meta-block"]');

    expect(wrapper).not.toBeNull();
    expect(block).not.toBeNull();
    expect(wrapper?.contains(block)).toBe(true);
    expect(wrapper?.className).toContain('sm:contents');

    const blockClasses = (block?.className ?? '').split(/\s+/);
    expect(blockClasses).toContain('flex-1');
    expect(blockClasses).toContain('min-w-0');
  });
});
