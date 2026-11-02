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
});
