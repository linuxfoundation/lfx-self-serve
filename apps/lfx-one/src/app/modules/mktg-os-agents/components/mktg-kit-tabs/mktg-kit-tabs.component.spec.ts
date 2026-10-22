// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ProjectContextService } from '@services/project-context.service';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { describe, expect, it } from 'vitest';
import { MktgKitTabsComponent } from './mktg-kit-tabs.component';

describe('Routed kit tabs', () => {
  it('preserves lens and project query parameters, marks only the exact page active', async () => {
    const context = signal({ uid: 'synthetic', slug: 'synthetic' });
    TestBed.configureTestingModule({
      imports: [MktgKitTabsComponent],
      providers: [provideRouter([{ path: '**', children: [] }]), { provide: ProjectContextService, useValue: { activeContext: context } }],
    });
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/foundation/mktg-os-agents/documents?project=synthetic');
    const fixture = TestBed.createComponent(MktgKitTabsComponent);
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelectorAll('a')).toHaveLength(4);
    expect(root.querySelector('nav')?.classList.contains('overflow-x-auto')).toBe(true);
    expect(root.querySelector('nav')?.classList.contains('flex-wrap')).toBe(false);
    expect(root.querySelectorAll('a')[3].textContent?.trim()).toBe('Documents');
    expect(root.querySelector('[data-testid="mktg-kit-tab-documents"]')?.getAttribute('href')).toBe('/foundation/mktg-os-agents/documents?project=synthetic');
    expect(root.querySelector('[aria-current="page"]')?.textContent?.trim()).toBe('Documents');
    expect(root.querySelector('[data-testid="mktg-kit-tab-kit"]')?.getAttribute('href')).toBe('/foundation/mktg-os-agents?project=synthetic');
    context.set({ uid: 'next', slug: 'next-project' });
    await fixture.whenStable();
    expect(router.url).toContain('project=synthetic');
    for (const link of root.querySelectorAll<HTMLAnchorElement>('a')) expect(link.search).toBe('?project=next-project');
    await router.navigateByUrl('/foundation/mktg-os-agents?project=synthetic');
    await fixture.whenStable();
    expect(root.querySelector('[aria-current="page"]')?.textContent?.trim()).toBe('Kit');
  });
});
