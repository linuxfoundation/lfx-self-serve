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
    inputs: {
      emails?: AudienceLastSentEmail[];
      masterLists?: AudienceMasterListBrief[];
      selectedIds?: ReadonlySet<string>;
      disabled?: boolean;
      mastersFailed?: boolean;
      emailsFailed?: boolean;
      canAttach?: boolean;
      canUseExistingMaster?: boolean;
      attachedListId?: string | null;
      attachedMasterId?: string | null;
      attachedExclusionIds?: readonly string[];
    } = {}
  ): void {
    fixture.componentRef.setInput('emails', inputs.emails ?? []);
    fixture.componentRef.setInput('attachedListId', inputs.attachedListId ?? null);
    // Defaults to `attachedListId`: the recorded exclusions match the ticks unless a test says not.
    fixture.componentRef.setInput('attachedMasterId', inputs.attachedMasterId === undefined ? (inputs.attachedListId ?? null) : inputs.attachedMasterId);
    fixture.componentRef.setInput('attachedExclusionIds', inputs.attachedExclusionIds ?? []);
    // Defaults to `canAttach`: most tests here predate the separate master-reuse gate and mean
    // "attaching is possible", not "the suppression lookup has not settled".
    fixture.componentRef.setInput('canUseExistingMaster', inputs.canUseExistingMaster ?? inputs.canAttach ?? false);
    fixture.componentRef.setInput('masterLists', inputs.masterLists ?? []);
    fixture.componentRef.setInput('selectedIds', inputs.selectedIds ?? new Set<string>());
    fixture.componentRef.setInput('loading', false);
    fixture.componentRef.setInput('mastersFailed', inputs.mastersFailed ?? false);
    fixture.componentRef.setInput('emailsFailed', inputs.emailsFailed ?? false);
    fixture.componentRef.setInput('disabled', inputs.disabled ?? false);
    fixture.componentRef.setInput('canAttach', inputs.canAttach ?? false);
    fixture.detectChanges();
  }

  it('marks an unresolvable SUPPRESSION list, not just an inclusion', () => {
    // `missing` applies to both arrays and matters more here: an exclusion the reconstruction
    // cannot resolve is a regulatory list nobody can account for. Rendered as a blank name plus
    // "size unknown" it read as an ordinary row.
    render({
      emails: [
        {
          emailId: '55',
          emailName: 'Synthetic Summit Invite',
          sentAt: '2026-01-01T00:00:00Z',
          hubspotUrl: 'https://app.hubspot.com/x/55',
          includedLists: [],
          suppressionLists: [{ listId: '902', name: '', missing: true } as unknown as AudienceListBrief],
        } as AudienceLastSentEmail,
      ],
    });

    expect(
      host().querySelector('[data-testid="audience-last-sent-suppression-missing-902"]'),
      'an unresolvable exclusion was presented as an ordinary suppression row'
    ).not.toBeNull();
  });

  it('says an unreadable selection is unknown, not empty', () => {
    // Both list arrays arrive empty whether the send targeted nobody OR the read failed, so
    // "None recorded." presents an unknown audience as a verified one — and this panel is
    // precedent for the operator's next send.
    render({
      emails: [
        {
          emailId: '55',
          emailName: 'Synthetic Summit Invite',
          sentAt: '2026-01-01T00:00:00Z',
          hubspotUrl: 'https://app.hubspot.com/x/55',
          includedLists: [],
          suppressionLists: [],
          listsUnavailable: true,
        } as AudienceLastSentEmail,
      ],
    });

    expect(
      host().querySelector('[data-testid="audience-last-sent-lists-unavailable"]'),
      'a failed selection read was not distinguished from an empty one'
    ).not.toBeNull();
    expect(host().textContent, 'an unknown audience was rendered as a verified empty one').not.toContain('None recorded');
  });

  it('says a failed read failed, instead of asserting nothing was sent', () => {
    // A fetch failure and a portal that genuinely holds nothing rendered the IDENTICAL empty arm,
    // so "No past marketing email ... was found in HubSpot" stated a verified absence on a branch
    // that also runs during an outage. An operator reading that rebuilds an audience they already
    // have, or assumes an event was never mailed. Same contract as the suppression grid's `failed`.
    render({ emailsFailed: true, mastersFailed: true });

    const emailsErr = host().querySelector('[data-testid="audience-last-sent-emails-error"]');
    const mastersErr = host().querySelector('[data-testid="audience-last-sent-masters-error"]');
    expect(emailsErr, 'a failed send-history read rendered as a verified absence').not.toBeNull();
    expect(mastersErr, 'a failed master-list read rendered as a verified absence').not.toBeNull();

    // And the absence claims must NOT be on screen at the same time.
    expect(host().textContent).not.toContain('No past marketing email for this event was found in HubSpot.');
    expect(host().textContent).not.toContain('No master list has been built for this event yet.');
  });

  it('still reports a genuine absence as an absence', () => {
    // The failure arm must not swallow the real empty case, which is the common one.
    render({ emailsFailed: false, mastersFailed: false });

    expect(host().querySelector('[data-testid="audience-last-sent-emails-error"]')).toBeNull();
    expect(host().textContent).toContain('No past marketing email for this event was found in HubSpot.');
  });

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

  describe('matching a prior send against the current attachment', () => {
    // Matching on the include list ALONE treated two sends that share a master but suppress
    // differently as the same audience: attaching either marked BOTH "Same lists used for this
    // email" and disabled both reuse buttons, so the operator could not then pick the other
    // send's exclusions. The full selection is what identifies a send.
    it('does not mark a send attached when its exclusions differ', () => {
      render({
        emails: [email({ emailId: 'em-other', suppressionLists: [brief({ listId: '901', name: 'Opt-outs' })] })],
        attachedListId: '301',
        attachedExclusionIds: ['902'],
      });

      const text = host().textContent ?? '';
      expect(text, 'a send with different exclusions was reported as the attached one').not.toContain('Same lists used for this email');
    });

    it('marks a send attached when the whole selection matches', () => {
      render({
        emails: [email({ suppressionLists: [brief({ listId: '901', name: 'Opt-outs' })] })],
        attachedListId: '301',
        attachedExclusionIds: ['901'],
      });

      expect(host().textContent ?? '').toContain('Same lists used for this email');
    });

    it("ignores exclusion ORDER, which is the portal's and not the operator's", () => {
      render({
        emails: [
          email({
            suppressionLists: [brief({ listId: '901', name: 'A' }), brief({ listId: '902', name: 'B' })],
          }),
        ],
        attachedListId: '301',
        attachedExclusionIds: ['902', '901'],
      });

      expect(host().textContent ?? '').toContain('Same lists used for this email');
    });
  });

  describe('reported list memberships', () => {
    // An earlier version of this label said "N contacts" and then "at least N contacts". Both
    // were wrong, and in opposite directions at once:
    //
    //   - a sum OVER-counts whenever lists overlap, which the api-catalog records as the normal
    //     case ("registrant/speaker overlap is the normal case"), so "at least" is a FALSE floor;
    //   - a list whose size HubSpot withheld contributes nothing, so it can understate too.
    //
    // No honest inequality exists, so the label states what the number IS.
    it('states memberships rather than claiming a contact count', () => {
      render({
        emails: [email({ includedLists: [brief({ size: 5000 }), brief({ listId: '302', name: 'Speakers', size: 5000 })] })],
      });

      const text = host().textContent ?? '';
      expect(text).toContain('10,000 list memberships');
      expect(text).toContain('lists may overlap');
      expect(text, 'a sum of overlapping lists is not a contact count').not.toContain('10,000 contacts');
      expect(text, '"at least" is a false floor when the union can be smaller than the sum').not.toContain('at least');
    });

    it('names how many lists reported a size when some did not', () => {
      render({
        emails: [email({ includedLists: [brief({ size: 5000 }), brief({ listId: '302', name: 'Speakers', size: undefined })] })],
      });

      expect(host().textContent ?? '').toContain('across 1 of 2 lists');
    });

    it('counts a MISSING list against completeness', () => {
      // `usable` drops missing lists, so a send whose third list was deleted reported
      // "across 2 of 2" and read as complete -- the completeness claim silently excluded the
      // very thing that made it incomplete.
      render({
        emails: [
          email({
            includedLists: [
              brief({ size: 5000 }),
              brief({ listId: '302', name: 'Speakers', size: 120 }),
              brief({ listId: '303', missing: true, size: undefined }),
            ],
          }),
        ],
      });

      const text = host().textContent ?? '';
      expect(text, 'a deleted list must not be excluded from the completeness count').toContain('across 2 of 3 lists');
    });

    it('says nothing when no list reported a size', () => {
      render({ emails: [email({ includedLists: [brief({ size: undefined })] })] });

      expect(host().textContent ?? '').not.toContain('list memberships');
    });
  });

  describe('reusing lists without composing', () => {
    function click(testId: string): void {
      host().querySelector<HTMLElement>(`[data-testid="${testId}"]`)?.click();
      fixture.detectChanges();
    }

    it('emits useSendLists for a single-include send', () => {
      const seen: AudienceLastSentEmail[] = [];
      fixture.componentInstance.useSendLists.subscribe((e) => seen.push(e));
      render({ emails: [email()], canAttach: true });

      click('audience-last-sent-use-em-1');

      expect(seen.map((e) => e.emailId)).toEqual(['em-1']);
    });

    it('blocks a send that included several lists — an email has one include list', () => {
      const seen: AudienceLastSentEmail[] = [];
      fixture.componentInstance.useSendLists.subscribe((e) => seen.push(e));
      render({ emails: [email({ includedLists: [brief(), brief({ listId: '302', name: 'Other' })] })], canAttach: true });

      click('audience-last-sent-use-em-1');

      expect(seen).toEqual([]);
      expect(host().querySelector('[data-testid="audience-last-sent-use-blocked-em-1"]')).not.toBeNull();
    });

    it('blocks a send whose suppression list no longer resolves', () => {
      render({ emails: [email({ suppressionLists: [brief({ listId: '902', missing: true })] })], canAttach: true });

      expect(host().querySelector('[data-testid="audience-last-sent-use-blocked-em-1"]')).not.toBeNull();
    });

    it('still lets a multi-list send be copied into the selection', () => {
      const seen: AudienceLastSentEmail[] = [];
      fixture.componentInstance.copySelection.subscribe((e) => seen.push(e));
      render({ emails: [email({ includedLists: [brief(), brief({ listId: '302', name: 'Other' })] })], canAttach: true });

      click('audience-last-sent-copy-em-1');

      expect(seen).toHaveLength(1);
    });

    it('emits useMasterList for an existing master', () => {
      const seen: AudienceMasterListBrief[] = [];
      fixture.componentInstance.useMasterList.subscribe((l) => seen.push(l));
      render({ masterLists: [master()], canAttach: true });

      click('audience-last-sent-master-use-401');

      expect(seen.map((l) => l.listId)).toEqual(['401']);
    });

    it('keeps the Attached badge on the master the brief points at, and re-enables reuse, once the ticks change', () => {
      // The badge says what the brief POINTS AT; the exclusion ticks do not change that. Keyed on the
      // exclusion match, the real send list lost its badge the moment a suppression was toggled.
      render({ masterLists: [master()], canAttach: true, attachedListId: '401', attachedMasterId: null });

      const row = host().querySelector('[data-testid="audience-last-sent-master-401"]');
      const use = host().querySelector<HTMLButtonElement>('[data-testid="audience-last-sent-master-use-401"]');
      expect(row?.textContent, 'the attached master lost its badge').toContain('Attached');
      expect(use?.disabled, 'the new exclusions could not be recorded').toBe(false);
      expect(use?.textContent).toContain('Re-attach with the ticked exclusions');
    });

    it('disables reuse when the master and its exclusions both match the record', () => {
      render({ masterLists: [master()], canAttach: true, attachedListId: '401' });

      const use = host().querySelector<HTMLButtonElement>('[data-testid="audience-last-sent-master-use-401"]');
      expect(use?.disabled).toBe(true);
      expect(use?.textContent).toContain('Used for this email');
    });

    it('does not reuse an existing master while the suppression lookup is unsettled', () => {
      // This path submits the operator's TICKED suppressions. While the lookup is pending or
      // failed that set is empty for a reason unrelated to their intent, so attaching would
      // record a send audience with NO exclusions before anyone could review them.
      // `canUseSelectionDirectly` already blocked the equivalent action; this one did not.
      const seen: AudienceMasterListBrief[] = [];
      fixture.componentInstance.useMasterList.subscribe((l) => seen.push(l));
      render({ masterLists: [master()], canAttach: true, canUseExistingMaster: false });

      click('audience-last-sent-master-use-401');

      expect(seen, 'a master was reused before the suppression read settled').toEqual([]);
    });

    it("still reuses a prior send's lists while suppression is unsettled", () => {
      // The deliberate asymmetry: a prior send carries its OWN exclusions rather than the ticked
      // ones, so a pending lookup cannot empty them and the gate would only block useful work.
      const seen: AudienceLastSentEmail[] = [];
      fixture.componentInstance.useSendLists.subscribe((e) => seen.push(e));
      render({ emails: [email()], canAttach: true, canUseExistingMaster: false });

      click('audience-last-sent-use-em-1');

      expect(seen.map((e) => e.emailId)).toEqual(['em-1']);
    });

    it('explains why nothing can be attached when there is no brief', () => {
      const seen: AudienceMasterListBrief[] = [];
      fixture.componentInstance.useMasterList.subscribe((l) => seen.push(l));
      render({ masterLists: [master()], canAttach: false });

      click('audience-last-sent-master-use-401');

      expect(seen).toEqual([]);
      expect(host().querySelector('[data-testid="audience-last-sent-attach-unavailable"]')).not.toBeNull();
    });

    it('links list names to HubSpot when a link is known', () => {
      render({ emails: [email({ includedLists: [brief({ hubspotUrl: 'https://app.hubspot.com/contacts/1/objectLists/301/filters' })] })] });

      const link = host().querySelector<HTMLAnchorElement>('[data-testid="audience-last-sent-list-link-301"]');
      expect(link?.href).toContain('/objectLists/301');
    });
  });
});
