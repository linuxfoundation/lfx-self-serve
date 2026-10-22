// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { ProjectContextService } from '@services/project-context.service';
import { describe, expect, it } from 'vitest';
import { MktgKitPlaceholderComponent } from './mktg-kit-placeholder.component';

describe('Kit placeholder tabs', () => {
  for (const title of ['Requests', 'Access']) {
    it(`shows an honest ${title} empty state, not fabricated data`, async () => {
      TestBed.configureTestingModule({
        imports: [MktgKitPlaceholderComponent],
        providers: [provideRouter([]), { provide: ProjectContextService, useValue: { activeContext: () => ({ name: 'Synthetic Project' }) } }],
      });
      // Keep the real router's ActivatedRoute for child tab links.
      const route = TestBed.inject(ActivatedRoute);
      route.snapshot.data = { title };
      const fixture = TestBed.createComponent(MktgKitPlaceholderComponent);
      await fixture.whenStable();
      expect(fixture.nativeElement.textContent).toContain(`${title} comes with its own item`);
      expect(fixture.nativeElement.textContent).toContain('Coming soon');
      expect(fixture.nativeElement.querySelector('h1').textContent).toBe('Synthetic Project');
      expect(fixture.nativeElement.querySelector('[data-testid="mktg-breadcrumb-current"]')?.textContent).toBe(title);
      expect(fixture.nativeElement.querySelectorAll('[data-testid="mktg-breadcrumb"] a')).toHaveLength(1);
    });
  }
});
