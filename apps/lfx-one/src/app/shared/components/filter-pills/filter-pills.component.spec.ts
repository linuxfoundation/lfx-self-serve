// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FilterPillOption } from '@lfx-one/shared/interfaces';
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
    expect(fixture.nativeElement.querySelectorAll('button')).toHaveLength(2);
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
});
