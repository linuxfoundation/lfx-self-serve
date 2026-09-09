// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { OrgClaCoverageDialogData, OrgClaGroup } from '@lfx-one/shared/interfaces';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { describe, expect, it, vi } from 'vitest';

import { orgClaCoverageDialogConfig, OrgEasyclaCoverageDialogComponent } from './org-easycla-coverage-dialog.component';

describe('orgClaCoverageDialogConfig', () => {
  const group: OrgClaGroup = {
    id: 'signature-uuid-1',
    claGroupName: 'Nimbus Foundation CLA',
    foundationName: 'Nimbus Foundation',
    projects: [{ projectName: 'Cascade' }, { projectName: 'Driftwood' }],
    signed: true,
    status: 'signed',
    needsClaManager: false,
    claManagersCount: 2,
  };

  it('names the agreement in the dialog header', () => {
    expect(orgClaCoverageDialogConfig(group).header).toBe('Projects covered by Nimbus Foundation CLA');
  });

  it('asks for enough width to hold the header on one line', () => {
    // Narrower than this and a typical CLA Group name wraps the header, which is what the design's
    // 560px is buying. Pinned because the value reads as arbitrary and invites being trimmed.
    expect(orgClaCoverageDialogConfig(group).width).toBe('36rem');
  });

  it('keeps the dialog within a narrow viewport', () => {
    // The preferred width is fixed and the Aura preset caps nothing, so without this the dialog is
    // wider than a phone and the list's right edge and the Close control sit off screen.
    expect(orgClaCoverageDialogConfig(group).style).toEqual({ maxWidth: '90vw' });
  });
});

describe('OrgEasyclaCoverageDialogComponent', () => {
  const closeDialog = vi.fn();

  async function render(data: OrgClaCoverageDialogData): Promise<ComponentFixture<OrgEasyclaCoverageDialogComponent>> {
    closeDialog.mockReset();
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [OrgEasyclaCoverageDialogComponent],
      providers: [
        { provide: DynamicDialogConfig, useValue: { data } },
        { provide: DynamicDialogRef, useValue: { close: closeDialog } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(OrgEasyclaCoverageDialogComponent);
    fixture.detectChanges();
    return fixture;
  }

  /** Types into the real field rather than the protected form, so the reactive-forms wiring is under test too. */
  function search(fixture: ComponentFixture<OrgEasyclaCoverageDialogComponent>, term: string): void {
    const input = fixture.nativeElement.querySelector('[data-test="org-easycla-coverage-search"]') as HTMLInputElement;
    input.value = term;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function projectNames(fixture: ComponentFixture<OrgEasyclaCoverageDialogComponent>): (string | undefined)[] {
    return Array.from(fixture.nativeElement.querySelectorAll('[data-testid="org-easycla-coverage-project"]')).map((el) =>
      (el as HTMLElement).textContent?.trim()
    );
  }

  it('lists every covered project', async () => {
    const fixture = await render({
      claGroupName: 'Acme CLA',
      projects: [{ projectName: 'Cascade' }, { projectName: 'Driftwood' }],
    });

    expect(projectNames(fixture)).toEqual(['Cascade', 'Driftwood']);
  });

  it('explains when no individual projects are listed', async () => {
    const fixture = await render({ claGroupName: 'Acme CLA', projects: [] });

    expect(fixture.nativeElement.querySelector('[data-testid="org-easycla-coverage-empty"]')?.textContent).toContain('No individual projects are listed');
  });

  it('drops the subset caveat when the agreement covers the foundation', async () => {
    const fixture = await render({ claGroupName: 'Acme CLA', foundationName: 'Acme Foundation', projects: [] });

    // The empty branch states the agreement covers the foundation. Showing the "not necessarily
    // every project" caveat beside it would assert the opposite legal scope in the same dialog.
    expect(fixture.nativeElement.querySelector('[data-testid="org-easycla-coverage-hint"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="org-easycla-coverage-empty"]')?.textContent).toContain('covers the foundation');
  });

  it('warns that a named foundation is not covered in full', async () => {
    const fixture = await render({
      claGroupName: 'Acme CLA',
      foundationName: 'Acme Foundation',
      projects: [{ projectName: 'Cascade' }],
    });

    expect(fixture.nativeElement.querySelector('[data-testid="org-easycla-coverage-hint"]')?.textContent?.trim()).toBe(
      'Part of Acme Foundation — this CLA covers the projects below, not necessarily every project in the foundation.'
    );
  });

  it('makes no foundation claim when the agreement names none', async () => {
    const fixture = await render({ claGroupName: 'Acme CLA', projects: [{ projectName: 'Cascade' }] });

    expect(fixture.nativeElement.querySelector('[data-testid="org-easycla-coverage-hint"]')?.textContent?.trim()).toBe('This CLA covers the projects below.');
  });

  it('offers a dismiss control that closes the dialog', async () => {
    const fixture = await render({ claGroupName: 'Acme CLA', projects: [{ projectName: 'Cascade' }] });
    const close = fixture.nativeElement.querySelector('[data-testid="org-easycla-coverage-close"] button') as HTMLButtonElement | null;

    expect(close).not.toBeNull();
    close?.click();

    expect(closeDialog).toHaveBeenCalledOnce();
  });

  it('scrolls a long list rather than growing past the dismiss control', async () => {
    const fixture = await render({
      claGroupName: 'Acme CLA',
      projects: Array.from({ length: 14 }, (_, i) => ({ projectName: `Project ${i + 1}` })),
    });
    const list = fixture.nativeElement.querySelector('[data-testid="org-easycla-coverage-list"]') as HTMLElement | null;

    expect(list?.className).toContain('max-h-80');
    expect(list?.className).toContain('overflow-y-auto');
  });

  it('offers the dismiss control even when no projects are listed', async () => {
    const fixture = await render({ claGroupName: 'Acme CLA', projects: [] });

    expect(fixture.nativeElement.querySelector('[data-testid="org-easycla-coverage-close"]')).not.toBeNull();
  });

  it('separates the projects into rules rather than listing them bare', async () => {
    const fixture = await render({
      claGroupName: 'Acme CLA',
      projects: [{ projectName: 'Cascade' }, { projectName: 'Driftwood' }],
    });
    const list = fixture.nativeElement.querySelector('[data-testid="org-easycla-coverage-list"]') as HTMLElement | null;
    const row = fixture.nativeElement.querySelector('[data-testid="org-easycla-coverage-project"]') as HTMLElement | null;

    // The design draws this as a bordered table, and the application renders its own lists the same
    // way. Pinned because a bare list reads as unfinished and looks like a tidy-up rather than a loss.
    expect(list?.className).toContain('divide-y');
    expect(list?.className).toContain('border');
    expect(row?.className).toContain('py-3');

    // No hover tint: these rows open nothing, so a highlight following the cursor advertises an
    // action that does not exist.
    expect(list?.className).not.toMatch(/hover:/);
    expect(row?.className).not.toMatch(/hover:/);
  });

  it('keeps the scrolling list reachable by keyboard', async () => {
    const fixture = await render({
      claGroupName: 'Acme CLA',
      projects: Array.from({ length: 14 }, (_, i) => ({ projectName: `Project ${i + 1}` })),
    });
    const list = fixture.nativeElement.querySelector('[data-testid="org-easycla-coverage-list"]') as HTMLElement | null;

    // The list holds no links or buttons, so without a tab stop of its own the clipped names cannot
    // be scrolled into view without a pointer.
    expect(list?.getAttribute('tabindex')).toBe('0');
    expect(list?.getAttribute('aria-label')).toBe('Covered projects');
  });

  describe('search', () => {
    const projects = [{ projectName: 'Cascade' }, { projectName: 'Driftwood' }, { projectName: 'Cascadia Tools' }];

    it('narrows the list to the projects matching the term', async () => {
      const fixture = await render({ claGroupName: 'Acme CLA', projects });

      search(fixture, 'casc');

      expect(projectNames(fixture)).toEqual(['Cascade', 'Cascadia Tools']);
    });

    it('matches regardless of case', async () => {
      const fixture = await render({ claGroupName: 'Acme CLA', projects });

      search(fixture, 'DRIFTWOOD');

      expect(projectNames(fixture)).toEqual(['Driftwood']);
    });

    it('matches on any part of a name, not only its start', async () => {
      const fixture = await render({ claGroupName: 'Acme CLA', projects });

      search(fixture, 'wood');

      expect(projectNames(fixture)).toEqual(['Driftwood']);
    });

    it('says nothing matched rather than showing an empty list', async () => {
      const fixture = await render({ claGroupName: 'Acme CLA', projects });

      search(fixture, 'nimbus');

      // An empty list with no explanation reads as a load failure, and the caveat above it still
      // claims the agreement covers projects — so the dialog would contradict itself in silence.
      expect(fixture.nativeElement.querySelector('[data-testid="org-easycla-coverage-list"]')).toBeNull();
      expect(fixture.nativeElement.querySelector('[data-testid="org-easycla-coverage-no-match"]')?.textContent?.trim()).toBe(
        'No covered projects match your search.'
      );
    });

    it('restores the full list when the term is cleared', async () => {
      const fixture = await render({ claGroupName: 'Acme CLA', projects });

      search(fixture, 'nimbus');
      search(fixture, '');

      expect(projectNames(fixture)).toEqual(['Cascade', 'Driftwood', 'Cascadia Tools']);
      expect(fixture.nativeElement.querySelector('[data-testid="org-easycla-coverage-no-match"]')).toBeNull();
    });

    it('treats a whitespace-only term as no term at all', async () => {
      const fixture = await render({ claGroupName: 'Acme CLA', projects });

      search(fixture, '   ');

      // Without trimming, a stray space matches nothing and the dialog claims the agreement covers
      // no projects — the worst reading available, produced by the least deliberate input.
      expect(projectNames(fixture)).toEqual(['Cascade', 'Driftwood', 'Cascadia Tools']);
    });

    it('gives the field an accessible name, since the dialog header is not its label', async () => {
      const fixture = await render({ claGroupName: 'Acme CLA', projects });
      const input = fixture.nativeElement.querySelector('[data-test="org-easycla-coverage-search"]') as HTMLInputElement | null;
      const label = fixture.nativeElement.querySelector('label[for="org-easycla-coverage-search-input"]') as HTMLElement | null;

      expect(input?.id).toBe('org-easycla-coverage-search-input');
      expect(label?.textContent?.trim()).toBe('Search covered projects');
    });

    it('announces what the filter did, since focus stays in the field', async () => {
      const fixture = await render({ claGroupName: 'Acme CLA', projects });
      const region = () => fixture.nativeElement.querySelector('[data-testid="org-easycla-coverage-announcement"]') as HTMLElement | null;

      // Mounted and silent before a term is typed. Both halves matter: a region created alongside
      // its text is frequently not announced, and a count nobody asked for is noise on open.
      expect(region()).not.toBeNull();
      expect(region()?.getAttribute('aria-live')).toBe('polite');
      // `role` is the hook assistive tech maps to a status region, and `aria-atomic` is what makes
      // the whole sentence re-announce when only the count within it changes.
      expect(region()?.getAttribute('role')).toBe('status');
      expect(region()?.getAttribute('aria-atomic')).toBe('true');
      expect(region()?.textContent?.trim()).toBe('');

      search(fixture, 'casc');
      expect(region()?.textContent?.trim()).toBe('2 projects match "casc".');

      // Two terms can match the same count; quoting the term is what makes the text node change.
      search(fixture, 'ca');
      expect(region()?.textContent?.trim()).toBe('2 projects match "ca".');

      search(fixture, 'wood');
      expect(region()?.textContent?.trim()).toBe('1 project matches "wood".');

      search(fixture, 'nimbus');
      expect(region()?.textContent?.trim()).toBe('No covered projects match "nimbus".');

      search(fixture, '');
      expect(region()?.textContent?.trim()).toBe('Search cleared. Showing all covered projects.');

      // The announcement trims separately from the filter, so without this a blank term would
      // narrate "3 projects match your search." over a list correctly showing everything — the
      // full-count noise the region exists to suppress. Whitespace-only is not a search, so it
      // stays silent even after a real term was typed and cleared.
      search(fixture, '   ');
      expect(region()?.textContent?.trim()).toBe('');
    });

    it('offers no search where there is no list to search', async () => {
      const fixture = await render({ claGroupName: 'Acme CLA', foundationName: 'Acme Foundation', projects: [] });

      expect(fixture.nativeElement.querySelector('[data-test="org-easycla-coverage-search"]')).toBeNull();
    });
  });
});
