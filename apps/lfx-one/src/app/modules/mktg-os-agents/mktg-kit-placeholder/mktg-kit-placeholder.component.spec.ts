// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { MKTG_KIT_TABS } from '@lfx-one/shared/constants';
import { ProjectContextService } from '@services/project-context.service';
import { describe, expect, it } from 'vitest';
import { MktgKitPlaceholderComponent } from './mktg-kit-placeholder.component';
import { MKTG_OS_AGENTS_ROUTES } from '../mktg-os-agents.routes';

describe('Kit placeholder tabs', () => {
  for (const { path: tab, label: title } of MKTG_KIT_TABS.filter((entry) => entry.path === 'requests' || entry.path === 'access')) {
    it(`shows an honest ${title} empty state, not fabricated data`, async () => {
      TestBed.configureTestingModule({
        imports: [MktgKitPlaceholderComponent],
        providers: [provideRouter([]), { provide: ProjectContextService, useValue: { activeContext: () => ({ name: 'Synthetic Project' }) } }],
      });
      // Keep the real router's ActivatedRoute for child tab links.
      const route = TestBed.inject(ActivatedRoute);
      route.snapshot.data = { ...MKTG_OS_AGENTS_ROUTES.find((entry) => entry.path === tab)?.data, title: `${title} copy` };
      expect(route.snapshot.data['tab']).toBe(tab);
      const fixture = TestBed.createComponent(MktgKitPlaceholderComponent);
      await fixture.whenStable();
      expect(fixture.nativeElement.textContent).toContain(`${title} copy comes with its own item`);
      expect(fixture.nativeElement.textContent).toContain('Coming soon');
      expect(fixture.nativeElement.querySelector('h1').textContent).toBe('Synthetic Project');
      expect(fixture.nativeElement.querySelector('[data-testid="mktg-breadcrumb-current"]')?.textContent).toBe(title);
      expect(fixture.nativeElement.querySelectorAll('[data-testid="mktg-breadcrumb"] a')).toHaveLength(1);
    });
  }
});
