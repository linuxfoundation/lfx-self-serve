// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { VoteLinkThankYouComponent } from './vote-link-thank-you.component';

describe('VoteLinkThankYouComponent (#4753)', () => {
  let fixture: ComponentFixture<VoteLinkThankYouComponent>;

  const byId = (id: string) => fixture.nativeElement.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [VoteLinkThankYouComponent] });
    fixture = TestBed.createComponent(VoteLinkThankYouComponent);
    fixture.componentRef.setInput('title', 'Synthetic vote');
    fixture.detectChanges();
  });

  it('links to the votes list with a plain /votes href', () => {
    const link = byId('vote-link-thank-you-votes');

    expect(link?.textContent).toContain('See all your votes on LFX');
    expect(link?.getAttribute('href')).toBe('/votes');
  });

  it('shows the LFX mark linking to a plain /', () => {
    expect(byId('vote-link-lfx-mark')).not.toBeNull();
    expect(byId('vote-link-lfx-mark-link')?.getAttribute('href')).toBe('/');
  });

  it('says the vote can be changed from the same link by default (#4723)', () => {
    fixture.componentRef.setInput('endTime', '2099-01-01T00:00:00Z');
    fixture.detectChanges();

    expect(byId('vote-link-thank-you-deadline')?.textContent).toContain('You can change your vote until then from the same link.');
    expect(byId('vote-link-thank-you-deadline')?.textContent).not.toContain('Your vote is final.');
  });

  it('says the vote is final when changes are not allowed (#4723)', () => {
    fixture.componentRef.setInput('endTime', '2099-01-01T00:00:00Z');
    fixture.componentRef.setInput('canChange', false);
    fixture.detectChanges();

    expect(byId('vote-link-thank-you-deadline')?.textContent).toContain('Your vote is final.');
    expect(byId('vote-link-thank-you-deadline')?.textContent).not.toContain('You can change your vote');
  });
});
