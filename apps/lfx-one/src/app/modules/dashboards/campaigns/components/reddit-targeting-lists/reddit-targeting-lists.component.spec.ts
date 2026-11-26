// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { RedditTargetingListsDraft } from '@lfx-one/shared/interfaces';
import { UiComboboxComponent } from '@shared/uikit/combobox/combobox.component';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RedditTargetingListsComponent } from './reddit-targeting-lists.component';

// The rules (prefix, blanks, repeats, caps) are tested in `campaign-reddit-targeting-lists.utils.spec.ts`; these test the wiring.
describe('RedditTargetingListsComponent', () => {
  let fixture: ComponentFixture<RedditTargetingListsComponent>;

  const query = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  const lists = (): RedditTargetingListsDraft => fixture.componentInstance.lists();
  // The protected handler, reached the way the template reaches it.
  const add = (key: string, value: string): void => {
    (fixture.componentInstance as unknown as Record<string, (...args: unknown[]) => void>)['onAdd'](key, value, {
      writeValue: vi.fn(),
    } as unknown as UiComboboxComponent);
    fixture.detectChanges();
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [RedditTargetingListsComponent] }).compileComponents();
    fixture = TestBed.createComponent(RedditTargetingListsComponent);
    fixture.componentRef.setInput('lists', { subreddits: ['r/kubernetes'], interests: ['Technology'] });
    fixture.detectChanges();
  });

  it('shows the seeded lists and adds typed entries, a subreddit without its r/', () => {
    expect(query('reddit-targeting-lists-subreddits-r/kubernetes')?.textContent).toContain('r/kubernetes');

    add('subreddits', 'r/devops');
    add('interests', 'Programming');
    expect(lists()).toEqual({ subreddits: ['r/kubernetes', 'devops'], interests: ['Technology', 'Programming'] });
  });

  it('refuses a blank entry and removes one', () => {
    add('interests', '   ');
    expect(query('reddit-targeting-lists-add-error')?.textContent).toContain('Enter a Reddit interest name or id.');

    query('reddit-targeting-lists-interests-remove-Technology')?.click();
    fixture.detectChanges();
    expect(lists().interests).toEqual([]);
  });
});
