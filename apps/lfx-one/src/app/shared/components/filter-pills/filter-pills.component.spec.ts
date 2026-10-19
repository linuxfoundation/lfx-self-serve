// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { FilterPillOption } from '@lfx-one/shared/interfaces';
import { Tooltip } from 'primeng/tooltip';
import { beforeEach, describe, expect, it } from 'vitest';

import { FilterPillsComponent } from './filter-pills.component';

/**
 * The first component spec in this app, and deliberately one that exercises
 * every part of the harness rather than the smallest possible thing: an
 * external `templateUrl` (so the Angular compiler really ran), signal inputs
 * set through `setInput`, `@for` control flow, a PrimeNG directive in
 * `imports`, an `output`, and DOM assertions that only hold if zoneless change
 * detection actually flushed. If the harness regresses, this fails before any
 * feature spec does.
 */
describe('FilterPillsComponent', () => {
  const options: FilterPillOption[] = [
    { id: 'all', label: 'All' },
    { id: 'kubecon', label: 'KubeCon', fullLabel: 'KubeCon + CloudNativeCon' },
  ];

  let fixture: ComponentFixture<FilterPillsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [FilterPillsComponent] }).compileComponents();
    fixture = TestBed.createComponent(FilterPillsComponent);
    fixture.componentRef.setInput('options', options);
    fixture.componentRef.setInput('selectedFilter', 'all');
    await fixture.whenStable();
  });

  function pill(id: string): HTMLButtonElement {
    const el = fixture.nativeElement.querySelector(`[data-testid="filter-pill-${id}"]`);
    if (!el) throw new Error(`no pill rendered for ${id}`);
    return el as HTMLButtonElement;
  }

  it('renders one pill per option', () => {
    expect(fixture.nativeElement.querySelectorAll('[data-testid^="filter-pill-"]')).toHaveLength(2);
    expect(pill('kubecon').textContent?.trim()).toBe('KubeCon');
  });

  it('marks only the selected pill as pressed', () => {
    expect(pill('all').getAttribute('aria-pressed')).toBe('true');
    expect(pill('kubecon').getAttribute('aria-pressed')).toBe('false');
  });

  // The assertion that proves change detection ran without zone.js: nothing
  // here triggers a manual `detectChanges`, so a DOM that updates after
  // `whenStable` alone is the zoneless scheduler doing its job.
  it('moves the pressed state when the selected input changes', async () => {
    fixture.componentRef.setInput('selectedFilter', 'kubecon');
    await fixture.whenStable();

    expect(pill('all').getAttribute('aria-pressed')).toBe('false');
    expect(pill('kubecon').getAttribute('aria-pressed')).toBe('true');
  });

  it('emits the clicked option id rather than its label', async () => {
    const emitted: string[] = [];
    fixture.componentInstance.filterChange.subscribe((id) => emitted.push(id));

    pill('kubecon').click();
    await fixture.whenStable();

    expect(emitted).toEqual(['kubecon']);
  });

  // fullLabel is the accessible name when it exists, because the visible label
  // is the truncated one — a screen reader getting "KubeCon" where a sighted
  // user gets the tooltip's full text is the defect this pins.
  it('prefers fullLabel for the accessible name and falls back to label', () => {
    expect(pill('kubecon').getAttribute('aria-label')).toBe('KubeCon + CloudNativeCon');
    expect(pill('all').getAttribute('aria-label')).toBe('All');
  });

  // ariaLabel names the pill for assistive technology without a tooltip — e.g. a status tab whose
  // visible count is unavailable reads "Active, count unavailable" rather than "Active (–)".
  it.each(['pill', 'segmented', 'track'] as const)('prefers ariaLabel for the accessible name without enabling a tooltip (%s)', async (variant) => {
    fixture.componentRef.setInput('variant', variant);
    fixture.componentRef.setInput('options', [...options, { id: 'active', label: 'Active (–)', ariaLabel: 'Active, count unavailable' }]);
    await fixture.whenStable();

    expect(pill('active').getAttribute('aria-label')).toBe('Active, count unavailable');
    expect(pill('active').textContent?.trim()).toBe('Active (–)');
    const tooltip = fixture.debugElement.query(By.css('[data-testid="filter-pill-active"]')).injector.get(Tooltip);
    expect(tooltip.disabled).toBe(true);
  });

  it('renders the segmented variant as one labelled group with the same pill contract', async () => {
    fixture.componentRef.setInput('variant', 'segmented');
    fixture.componentRef.setInput('ariaLabel', 'Time range');
    await fixture.whenStable();

    const group = fixture.nativeElement.querySelector('[role="group"]') as HTMLElement | null;
    expect(group?.getAttribute('aria-label')).toBe('Time range');
    expect(group?.querySelectorAll('[data-testid^="filter-pill-"]')).toHaveLength(2);
    expect(pill('all').getAttribute('aria-pressed')).toBe('true');
    expect(pill('kubecon').getAttribute('aria-pressed')).toBe('false');
  });

  it('keeps the default pill look, so pages that do not opt in are unchanged', () => {
    expect(fixture.nativeElement.querySelector('[data-testid="filter-pills-track"]')).toBeNull();
    expect(pill('all').className).toContain('bg-blue-500');
    expect(pill('kubecon').className).toContain('bg-gray-100');
  });

  it('renders the track variant as one grey track with the selected option as a white chip', async () => {
    fixture.componentRef.setInput('variant', 'track');
    fixture.componentRef.setInput('ariaLabel', 'Group type');
    await fixture.whenStable();

    const track = fixture.nativeElement.querySelector('[data-testid="filter-pills-track"]') as HTMLElement | null;
    expect(track?.classList).toContain('overflow-x-auto');
    const group = track?.querySelector('[role="group"]') as HTMLElement | null;
    expect(group?.getAttribute('aria-label')).toBe('Group type');
    expect(group?.classList).toContain('bg-gray-100');
    expect(pill('all').className).toContain('bg-white');
    expect(pill('all').className).not.toContain('bg-blue-500');
    expect(pill('kubecon').className).toContain('text-gray-600');
    expect(pill('all').getAttribute('aria-pressed')).toBe('true');
  });

  it('lets a track host shrink inside a flex row, so the track scrolls instead of spilling out', async () => {
    const host = fixture.nativeElement as HTMLElement;
    expect(host.classList).not.toContain('min-w-0');

    fixture.componentRef.setInput('variant', 'track');
    await fixture.whenStable();

    expect(host.classList).toContain('block');
    expect(host.classList).toContain('min-w-0');
    expect(host.classList).toContain('max-w-full');
  });
});
