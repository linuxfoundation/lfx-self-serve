// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DEFAULT_REDDIT_TARGETING_EXCLUSIONS } from '@lfx-one/shared/constants';
import type { RedditTargetingExclusionsDraft } from '@lfx-one/shared/interfaces';
import { UiComboboxComponent } from '@shared/uikit/combobox/combobox.component';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RedditTargetingExclusionsComponent } from './reddit-targeting-exclusions.component';

// The rules (name and code shape, overlap, caps) are tested in `campaign-reddit-targeting-exclusions.utils.spec.ts`; these test the wiring.
describe('RedditTargetingExclusionsComponent', () => {
  let fixture: ComponentFixture<RedditTargetingExclusionsComponent>;

  const query = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  const exclusions = (): RedditTargetingExclusionsDraft => fixture.componentInstance.exclusions();
  // The protected handler, reached the way the template reaches it.
  const add = (key: string, value: string): void => {
    (fixture.componentInstance as unknown as Record<string, (...args: unknown[]) => void>)['onAdd'](key, value, {
      writeValue: vi.fn(),
    } as unknown as UiComboboxComponent);
    fixture.detectChanges();
  };

  function render(enabled: boolean, held: Partial<RedditTargetingExclusionsDraft> = {}): void {
    fixture.componentRef.setInput('enabled', enabled);
    fixture.componentRef.setInput('targeted', { subreddits: ['kubernetes'], geoTargets: ['US'] });
    fixture.componentRef.setInput('exclusions', { ...DEFAULT_REDDIT_TARGETING_EXCLUSIONS, ...held });
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [RedditTargetingExclusionsComponent] }).compileComponents();
    fixture = TestBed.createComponent(RedditTargetingExclusionsComponent);
  });

  it('adds a typed subreddit and a picked country as chips, refusing a targeted one', () => {
    render(true);

    add('excludedSubreddits', 'r/politics');
    add('excludedGeoTargets', 'ca');
    expect(exclusions()).toEqual({ excludedSubreddits: ['politics'], excludedGeoTargets: ['CA'] });
    expect(query('reddit-targeting-exclusions-excludedSubreddits-politics')?.textContent).toContain('r/politics');
    expect(query('reddit-targeting-exclusions-excludedGeoTargets-CA')?.textContent).toContain('Canada');

    add('excludedGeoTargets', 'US');
    expect(query('reddit-targeting-exclusions-add-error')?.textContent).toContain('US is targeted');
    expect(exclusions().excludedGeoTargets).toEqual(['CA']);
  });

  it('shows nothing without the capability and without entries', () => {
    render(false);

    expect(query('reddit-targeting-exclusions')).toBeNull();
  });

  it('keeps held entries removable without the capability, offering no box', () => {
    render(false, { excludedSubreddits: ['politics'] });

    expect(query('reddit-targeting-exclusions-excludedSubreddits-add')).toBeNull();
    query('reddit-targeting-exclusions-excludedSubreddits-remove-politics')?.click();
    fixture.detectChanges();
    expect(exclusions().excludedSubreddits).toEqual([]);
  });
});
