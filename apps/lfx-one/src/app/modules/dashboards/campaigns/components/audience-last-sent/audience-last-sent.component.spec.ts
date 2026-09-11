// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import type { AudienceLastSentEmail, AudienceListBrief, AudienceMasterListBrief } from '@lfx-one/shared/interfaces';

import { AudienceLastSentComponent } from './audience-last-sent.component';

function brief(overrides: Partial<AudienceListBrief> = {}): AudienceListBrief {
  return { listId: '301', name: 'Synthetic Summit 2025 - Registrants', size: 900, missing: false, ...overrides };
}

function email(overrides: Partial<AudienceLastSentEmail> = {}): AudienceLastSentEmail {
  return {
    emailId: 'em-1',
    emailName: 'Synthetic Summit 2025 - Final call',
    sentAt: '2025-11-04T15:00:00Z',
    hubspotUrl: 'https://app.hubspot.com/email/1/details/em-1',
    includedLists: [brief()],
    suppressionLists: [],
    ...overrides,
  };
}

function master(overrides: Partial<AudienceMasterListBrief> = {}): AudienceMasterListBrief {
  return {
    listId: '401',
    name: '25Q4 - SYN - Synthetic Summit - Master',
    size: 2400,
    hubspotUrl: 'https://app.hubspot.com/contacts/1/objectLists/401',
    ...overrides,
  };
}

describe('AudienceLastSentComponent', () => {
  let fixture: ComponentFixture<AudienceLastSentComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [AudienceLastSentComponent] }).compileComponents();
    fixture = TestBed.createComponent(AudienceLastSentComponent);
  });

  function host(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function render(
    inputs: { emails?: AudienceLastSentEmail[]; masterLists?: AudienceMasterListBrief[]; selectedIds?: ReadonlySet<string>; disabled?: boolean } = {}
  ): void {
    fixture.componentRef.setInput('emails', inputs.emails ?? []);
    fixture.componentRef.setInput('masterLists', inputs.masterLists ?? []);
    fixture.componentRef.setInput('selectedIds', inputs.selectedIds ?? new Set<string>());
    fixture.componentRef.setInput('loading', false);
    fixture.componentRef.setInput('disabled', inputs.disabled ?? false);
    fixture.detectChanges();
  }

  it("emits the brief when a past send's list is added", () => {
    const emitted: AudienceListBrief[] = [];
    render({ emails: [email()] });
    fixture.componentInstance.addList.subscribe((list) => emitted.push(list));

    host().querySelector<HTMLElement>('[data-testid="audience-last-sent-add-301"]')?.click();

    expect(emitted.map((list) => list.listId)).toEqual(['301']);
  });

  it('marks a missing list and refuses to add it', () => {
    // `missing: true` means the v3 lookup AND the legacy-id recovery both failed -- there is no
    // list behind the id. Adding it would put an id into the compose request that HubSpot rejects,
    // and the operator would see a compose failure with no hint of which selection caused it.
    const emitted: AudienceListBrief[] = [];
    render({ emails: [email({ includedLists: [brief({ listId: '302', missing: true, size: undefined })] })] });
    fixture.componentInstance.addList.subscribe((list) => emitted.push(list));

    expect(host().querySelector('[data-testid="audience-last-sent-missing-302"]'), 'a missing list was not flagged').not.toBeNull();

    expect(host().querySelector('[data-testid="audience-last-sent-add-302"]'), 'a missing list offered an Add button').toBeNull();
    expect(emitted, 'a missing list reached the inclusion set').toEqual([]);
  });

  it('emits the master list on its own output, separate from the per-send lists', () => {
    // Two outputs rather than one: the container adds both to the same inclusion map, but a master
    // list is a finished audience and a per-send list is one signal, so the sections must not
    // share an Add path that would let one be styled or gated as the other.
    const emitted: AudienceMasterListBrief[] = [];
    render({ masterLists: [master()] });
    fixture.componentInstance.addMasterList.subscribe((list) => emitted.push(list));

    host().querySelector<HTMLElement>('[data-testid="audience-last-sent-master-add-401"]')?.click();

    expect(emitted.map((list) => list.listId)).toEqual(['401']);
  });

  it('renders "size unknown" rather than "0 contacts" when HubSpot reported no size', () => {
    render({ masterLists: [master({ size: undefined })] });

    const text = host().textContent ?? '';
    expect(text).toContain('size unknown');
    expect(text).not.toContain('0 contacts');
  });
});
