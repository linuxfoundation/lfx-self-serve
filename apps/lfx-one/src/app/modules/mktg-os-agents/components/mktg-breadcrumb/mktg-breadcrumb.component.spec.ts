// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { describe, expect, it } from 'vitest';
import { MktgBreadcrumbComponent } from './mktg-breadcrumb.component';

describe('Marketing kit breadcrumb', () => {
  it('links every parent with current project scope, drops stale query state and marks only the last crumb current', async () => {
    TestBed.configureTestingModule({ providers: [provideRouter([{ path: '**', children: [] }])] });
    await TestBed.inject(Router).navigateByUrl('/project/mktg-os-agents/documents/faq/living?project=stale&type=faq&revision=old');
    const fixture = TestBed.createComponent(MktgBreadcrumbComponent);
    fixture.componentRef.setInput('project', 'synthetic');
    fixture.componentRef.setInput('crumbs', [
      { label: 'Synthetic kit', route: ['/project/mktg-os-agents'] },
      { label: 'Positioning & brand', route: ['/project/mktg-os-agents', 'families', 'positioning-brand'] },
      { label: 'FAQ', route: ['/must-not-link-current'] },
    ]);
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('nav')?.getAttribute('aria-label')).toBe('Breadcrumb');
    expect(root.querySelectorAll('a')).toHaveLength(2);
    expect(root.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    expect(root.querySelector('[aria-current="page"]')?.textContent).toBe('FAQ');
    expect(root.querySelector('a')?.getAttribute('href')).toBe('/project/mktg-os-agents?project=synthetic');
    fixture.componentRef.setInput('project', 'next-project');
    await fixture.whenStable();
    expect(root.querySelector('a')?.getAttribute('href')).toContain('project=next-project');
  });
});
