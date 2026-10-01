// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Committee, GroupsIOMailingList } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it } from 'vitest';

import { CommitteeChannelsCardComponent } from './committee-channels-card.component';

describe('CommitteeChannelsCardComponent mailing-list addresses', () => {
  let fixture: ComponentFixture<CommitteeChannelsCardComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [CommitteeChannelsCardComponent] }).compileComponents();
    fixture = TestBed.createComponent(CommitteeChannelsCardComponent);
    fixture.componentRef.setInput('committee', { uid: 'committee-1' } as Committee);
  });

  it('links to an address from the indexed list domain with no readable service', async () => {
    fixture.componentRef.setInput('associatedMailingLists', [
      { uid: 'ml-1', group_name: 'main', domain: 'lists.example.org', subscriber_count: 2 } as GroupsIOMailingList,
    ]);
    await fixture.whenStable();

    const links = fixture.nativeElement.querySelectorAll('a[href^="mailto:"]') as NodeListOf<HTMLAnchorElement>;
    expect(links.length).toBe(2);
    expect(Array.from(links).map((link) => link.getAttribute('href'))).toEqual(['mailto:main@lists.example.org', 'mailto:main@lists.example.org']);
  });

  it('shows the list name and subscribers without an invalid mailto when the domain is missing', async () => {
    fixture.componentRef.setInput('associatedMailingLists', [{ uid: 'ml-1', group_name: 'main', subscriber_count: 2 } as GroupsIOMailingList]);
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('main');
    expect(fixture.nativeElement.textContent).toContain('2 subscribers');
    expect(fixture.nativeElement.querySelector('a[href^="mailto:"]')).toBeNull();
  });
});
