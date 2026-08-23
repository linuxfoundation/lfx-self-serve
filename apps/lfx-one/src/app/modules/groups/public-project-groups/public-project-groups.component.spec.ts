// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { GroupService } from '@services/group.service';
import { headerTestProviders, installMatchMediaShim } from '@shared/testing/header-test-providers';
import { of } from 'rxjs';
import { beforeAll, describe, expect, it } from 'vitest';

import type { PublicGroupDirectoryResponse, PublicGroupSummary } from '@lfx-one/shared/interfaces';

import { PublicProjectGroupsComponent } from './public-project-groups.component';

beforeAll(installMatchMediaShim);

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
        ...headerTestProviders(),
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

  it('behavioral class chip renders its label text and has no hidden class at any breakpoint, keeping its explicit flex + shrink-0', async () => {
    // The label text itself is asserted, not just the chip's presence — the WCAG 1.4.1 fix this
    // ticket makes is specifically that the behavioral class gains a *textual* signal on mobile
    // beside the row icon's color (aria-hidden), so an empty pill would still pass a presence-only
    // check without fixing the actual defect.
    //
    // `flex` and `shrink-0` are asserted, not just the absence of `hidden`, because a "drop
    // redundant class" pass could silently regress both without failing any other assertion here:
    // without `flex` the host still renders (it blockifies to `block` as a flex item either way) —
    // only the strut-height fix `flex` provides would quietly come back. Without `shrink-0` the
    // chip would default to flex-shrink: 1 once `sm:contents` folds the wrapper away at `sm+`,
    // letting it get squeezed instead of keeping its natural width.
    await render({ groups: [group()], total: 1 });

    const chip = fixture.nativeElement.querySelector('[data-testid="public-project-groups-item-class-chip"]');
    expect(chip).not.toBeNull();
    expect(chip?.textContent?.trim()).toBe('Working Groups');
    const chipClasses = (chip?.getAttribute('class') ?? '').split(/\s+/);
    expect(chipClasses.some((c: string) => c === 'hidden' || c.endsWith(':hidden'))).toBe(false);
    expect(chipClasses).toContain('flex');
    expect(chipClasses).toContain('shrink-0');
  });

  it('meta wrapper folds to display:contents at sm+, while both wrapper and inner block keep their own growing flex classes', async () => {
    // Regression lock: the wrapper's own flex-1/min-w-0 are load-bearing below `sm`, where it is
    // still a real flex item of the row and min-w-0 is what lets the truncated name line actually
    // truncate (the description line is `hidden sm:block`, so it isn't rendered below `sm` at
    // all). At sm+, `display: contents` gives the wrapper no box of its own, so those classes go
    // inert there — which is why the inner meta block must carry its own copies too, or the block
    // would collapse to content width once the wrapper stops applying them.
    await render({ groups: [group()], total: 1 });

    const wrapper = fixture.nativeElement.querySelector('[data-testid="public-project-groups-item-meta-wrapper"]');
    const block = fixture.nativeElement.querySelector('[data-testid="public-project-groups-item-meta-block"]');

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

  it('row keeps items-start/sm:items-center so the icon top-aligns against the stacked mobile column, not the desktop centering', async () => {
    // Regression lock: without `items-start`, the icon and chevron would vertically center against
    // the full two-line stacked column's height on mobile instead of aligning to its top — the same
    // "drop redundant class" risk the other tests in this file guard against.
    await render({ groups: [group()], total: 1 });

    const row = fixture.nativeElement.querySelector('[data-testid^="public-project-groups-item-"]');
    expect(row).not.toBeNull();
    const rowClasses = (row?.className ?? '').split(/\s+/);
    expect(rowClasses).toContain('items-start');
    expect(rowClasses).toContain('sm:items-center');
  });
});
