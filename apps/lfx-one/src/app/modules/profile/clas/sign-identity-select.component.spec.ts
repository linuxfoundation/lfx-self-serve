// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import type { GithubAccountOption, MyClaAgreement, SignIdentityDialogData } from '@lfx-one/shared/interfaces';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { Tooltip } from 'primeng/tooltip';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SignIdentitySelectComponent } from './sign-identity-select.component';

/**
 * Covers the sign identity step opened by DialogService (#1252, #1917, #2002).
 *
 * The dialog holds no authority — the backend re-derives the attested set from the caller's own
 * token — so what these tests protect is the contributor's *choice*: that every identity they
 * could sign under is offered, that nothing is chosen on their behalf, and that the dialog
 * closes with exactly what they picked. Those three are what the parent depends on.
 *
 * With nothing at all to offer there is no choice to protect, and the tests turn to the block
 * instead (#1917): that the list and its actions are gone rather than merely disabled, and that
 * asking to link an account is distinguishable from walking away. The sharp edge there is that
 * an empty *GitHub* list is no longer the same thing as nothing to offer.
 */
describe('SignIdentitySelectComponent', () => {
  const OCTOCAT: GithubAccountOption = { githubId: '12345', githubUsername: 'octocat' };
  const HUBOT: GithubAccountOption = { githubId: '67890', githubUsername: 'hubot' };
  const GERRIT_USER = 'jdoe';

  let fixture: ComponentFixture<SignIdentitySelectComponent>;
  let close: ReturnType<typeof vi.fn>;

  async function setup(data: Partial<SignIdentityDialogData> = {}): Promise<void> {
    TestBed.resetTestingModule();
    close = vi.fn();

    TestBed.configureTestingModule({
      imports: [SignIdentitySelectComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: DynamicDialogRef, useValue: { close } },
        { provide: DynamicDialogConfig, useValue: { data: { variant: 'github', accounts: [OCTOCAT, HUBOT], ...data } } },
      ],
    });

    fixture = TestBed.createComponent(SignIdentitySelectComponent);
    fixture.detectChanges();
    await fixture.whenStable();
  }

  function query(testId: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  }

  /** Picks a card the way a click does — the card writes the chosen value into the form. */
  async function choose(testId: string): Promise<void> {
    query(testId)?.click();
    fixture.detectChanges();
    await fixture.whenStable();
  }

  beforeEach(async () => {
    await setup();
  });

  // --- GitHub variant, unchanged by #2002 -----------------------------------

  it('offers every linked account', async () => {
    expect(query(`sign-identity-select-github-${OCTOCAT.githubId}`)).not.toBeNull();
    expect(query(`sign-identity-select-github-${HUBOT.githubId}`)).not.toBeNull();
  });

  it('shows the handle, since an account number means nothing to the contributor', async () => {
    expect(query(`sign-identity-select-github-${OCTOCAT.githubId}`)?.textContent).toContain('octocat');
  });

  it('leaves the handle bare on a single-source list, as the design writes it', async () => {
    expect(query(`sign-identity-select-github-${OCTOCAT.githubId}`)?.textContent).not.toContain('GitHub)');
  });

  it('falls back to the account number when the handle is blank, so the row is still identifiable', async () => {
    // The server maps a missing Auth0 nickname to '' rather than guessing a handle. Rendered
    // as-is that produces an unlabelled row, which is unusable in the one situation this
    // dialog is shown at all — a contributor choosing between two accounts.
    const NAMELESS: GithubAccountOption = { githubId: '55555', githubUsername: '' };
    await setup({ accounts: [OCTOCAT, NAMELESS] });

    expect(query(`sign-identity-select-github-${NAMELESS.githubId}`)?.textContent).toContain('55555');
  });

  it('preselects nothing', async () => {
    // A preselection is indistinguishable from a choice once submitted, and this step exists
    // precisely so the association stops being decided by list order.
    expect((fixture.componentInstance as any).selectedId()).toBeNull();
  });

  it('does not close until an identity is chosen', async () => {
    (fixture.componentInstance as any).onContinue();

    expect(close).not.toHaveBeenCalled();
  });

  it('closes with the account number the contributor picked', async () => {
    await choose(`sign-identity-select-github-${HUBOT.githubId}`);
    (fixture.componentInstance as any).onContinue();

    // The number, not the handle: handles get renamed and reclaimed by other people, so a
    // hand-off keyed on one could land on a different account than the one shown here.
    expect(close).toHaveBeenCalledWith({ kind: 'github', githubId: HUBOT.githubId });
  });

  it('closes with the later choice when the contributor changes their mind', async () => {
    await choose(`sign-identity-select-github-${OCTOCAT.githubId}`);
    await choose(`sign-identity-select-github-${HUBOT.githubId}`);
    (fixture.componentInstance as any).onContinue();

    expect(close).toHaveBeenCalledWith({ kind: 'github', githubId: HUBOT.githubId });
  });

  it('closes with nothing when the contributor backs out', async () => {
    await choose(`sign-identity-select-github-${OCTOCAT.githubId}`);
    (fixture.componentInstance as any).onCancel();

    // Null rather than the selection: the caller treats any account number as consent to
    // record it, so a cancel that leaked one would bind an association nobody confirmed.
    expect(close).toHaveBeenCalledWith(null);
  });

  // --- Gerrit variant (#2002) -----------------------------------------------

  it('offers the contributor their LF username as the Gerrit identity', async () => {
    await setup({ variant: 'gerrit', accounts: [], gerritUsername: GERRIT_USER });

    expect(query('sign-identity-select-gerrit')?.textContent).toContain(GERRIT_USER);
  });

  it('says the group is linked to Gerrit, not to GitHub', async () => {
    await setup({ variant: 'gerrit', accounts: [], gerritUsername: GERRIT_USER });

    // The one sentence in this flow that explains why an identity is being asked for. Reusing
    // the GitHub wording here would tell a Gerrit contributor something untrue about the group.
    expect(query('sign-identity-select-dialog')?.textContent).toContain('This CLA group is linked to Gerrit repositories');
    expect(query('sign-identity-select-dialog')?.textContent).not.toContain('linked to GitHub repositories');
  });

  it('preselects nothing even when the Gerrit identity is the only card', async () => {
    // The point of showing this step for a Gerrit group is that the contributor sees which
    // identity signs. A preselected sole card is a hand-off wearing a dialog.
    await setup({ variant: 'gerrit', accounts: [], gerritUsername: GERRIT_USER });

    expect((fixture.componentInstance as any).selectedId()).toBeNull();
    expect(query('sign-identity-select-continue')?.querySelector('button')?.disabled).toBe(true);
  });

  it('closes with the Gerrit choice, carrying no identity of its own', async () => {
    await setup({ variant: 'gerrit', accounts: [], gerritUsername: GERRIT_USER });
    await choose('sign-identity-select-gerrit');
    (fixture.componentInstance as any).onContinue();

    // No username on the wire: the Console resolves the signer from the LF SSO session, and
    // sending one from here would make a display label look like an assertion of identity.
    expect(close).toHaveBeenCalledWith({ kind: 'gerrit' });
  });

  it('never blocks a Gerrit group on a missing GitHub account', async () => {
    await setup({ variant: 'gerrit', accounts: [], gerritUsername: GERRIT_USER });

    expect(query('sign-identity-select-empty')).toBeNull();
  });

  // --- Mixed variant (#2002) ------------------------------------------------

  it('offers the GitHub accounts and the Gerrit identity in one dialog', async () => {
    await setup({ variant: 'github-or-gerrit', accounts: [OCTOCAT, HUBOT], gerritUsername: GERRIT_USER });

    expect(query(`sign-identity-select-github-${OCTOCAT.githubId}`)).not.toBeNull();
    expect(query(`sign-identity-select-github-${HUBOT.githubId}`)).not.toBeNull();
    expect(query('sign-identity-select-gerrit')).not.toBeNull();
  });

  it('names the platform on each card when two platforms share the list', async () => {
    await setup({ variant: 'github-or-gerrit', accounts: [OCTOCAT], gerritUsername: GERRIT_USER });

    // A GitHub handle and an LF username are routinely different strings for the same person.
    // Side by side without the suffix the two rows read as duplicates, or as one identity
    // listed twice — and choosing between them is what this variant exists for.
    expect(query(`sign-identity-select-github-${OCTOCAT.githubId}`)?.textContent).toContain('octocat (GitHub)');
    expect(query('sign-identity-select-gerrit')?.textContent).toContain(`${GERRIT_USER} (Gerrit)`);
  });

  it('says the group is linked to both platforms', async () => {
    await setup({ variant: 'github-or-gerrit', accounts: [OCTOCAT], gerritUsername: GERRIT_USER });

    expect(query('sign-identity-select-dialog')?.textContent).toContain('This CLA group is linked to GitHub and Gerrit repositories');
  });

  it('does not name GitHub twice on a blank handle in the mixed list', async () => {
    // The account-number fallback already carries the platform. Suffixing it would render
    // "GitHub account 55555 (GitHub)", which is the suffix explaining something it just said.
    const NAMELESS: GithubAccountOption = { githubId: '55555', githubUsername: '' };
    await setup({ variant: 'github-or-gerrit', accounts: [NAMELESS], gerritUsername: GERRIT_USER });

    const label = query(`sign-identity-select-github-${NAMELESS.githubId}`)?.textContent;
    expect(label).toContain('GitHub account 55555');
    expect(label).not.toContain('(GitHub)');
  });

  it('routes by the card chosen, not by the group', async () => {
    await setup({ variant: 'github-or-gerrit', accounts: [OCTOCAT], gerritUsername: GERRIT_USER });

    await choose('sign-identity-select-gerrit');
    (fixture.componentInstance as any).onContinue();
    expect(close).toHaveBeenLastCalledWith({ kind: 'gerrit' });

    await choose(`sign-identity-select-github-${OCTOCAT.githubId}`);
    (fixture.componentInstance as any).onContinue();
    expect(close).toHaveBeenLastCalledWith({ kind: 'github', githubId: OCTOCAT.githubId });
  });

  it('offers Gerrit rather than blocking when a mixed group has no linked GitHub account', async () => {
    await setup({ variant: 'github-or-gerrit', accounts: [], gerritUsername: GERRIT_USER });

    // The regression this change is most likely to introduce. The empty-account block was
    // written when a GitHub account was the only identity there was; applied here it would
    // stop a contributor who has a perfectly good identity for the group they picked.
    expect(query('sign-identity-select-empty')).toBeNull();
    expect(query('sign-identity-select-gerrit')).not.toBeNull();
    expect(query('sign-identity-select-continue')).not.toBeNull();
  });

  // --- Empty state (#1917) --------------------------------------------------

  it('blocks with an empty state instead of an empty list when nothing is linked', async () => {
    await setup({ accounts: [] });

    // The list and both footer actions give way to the empty state, so there is no Continue to
    // press and nothing to press it against — the block is structural, not a disabled button.
    expect(query('sign-identity-select-empty')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[role="listbox"]')).toBeNull();
    expect(query('sign-identity-select-continue')).toBeNull();
    expect(query('sign-identity-select-cancel')).toBeNull();
  });

  it('says which accounts are missing and where to link one', async () => {
    await setup({ accounts: [] });

    expect(query('sign-identity-select-empty')?.textContent).toContain('No GitHub accounts are connected to your profile yet');
    expect(query('sign-identity-select-link-accounts')?.textContent).toContain('Go to Identities');
  });

  it('keeps the group explanation above the empty state, as the design leaves it', async () => {
    await setup({ accounts: [] });

    // The design shows this paragraph at every account count, and its first sentence is the only
    // place the flow says why a GitHub account in particular is being asked for. Dropping it
    // because the second sentence reads oddly with nothing to choose from would be a rewrite of
    // copy that is taken verbatim, so it stays and this holds it there.
    expect(query('sign-identity-select-dialog')?.textContent).toContain('This CLA group is linked to GitHub repositories');
  });

  it('asks the caller to open Identities rather than navigating itself', async () => {
    await setup({ accounts: [] });

    query('sign-identity-select-link-accounts')?.querySelector('button')?.click();

    // Distinguishable from the dismissal below, which is the whole reason it is not just a
    // close: only one of the two should move the contributor off the page they started from.
    expect(close).toHaveBeenCalledWith({ linkAccounts: true });
  });

  it('cannot submit an identity from the empty state', async () => {
    await setup({ accounts: [] });

    (fixture.componentInstance as any).onContinue();

    expect(close).not.toHaveBeenCalled();
  });

  // --- Identities that already signed this CLA group (#1914) -----------------

  describe('already signed', () => {
    function signedAs(signedAs: string, signedVia: 'github' | 'gerrit' = 'github'): MyClaAgreement[] {
      return [
        { id: 's1', kind: 'ICLA', claGroupName: 'Venus', claGroupId: 'cg-1', signedOn: '2022-01-01', status: 'valid', pdfAvailable: true, signedVia, signedAs },
      ];
    }

    const REASON = 'You already have an ICLA for this CLA group signed with this account. Choose another identity to sign again.';

    it('grays out the account that already signed, and only that account', async () => {
      await setup({ claGroupAgreements: signedAs('octocat') });

      expect(query('sign-identity-select-github-12345')?.getAttribute('aria-disabled')).toBe('true');
      expect(query('sign-identity-select-github-67890')?.getAttribute('aria-disabled')).toBe('false');
    });

    it('says why, in the tooltip and to assistive tech', async () => {
      await setup({ claGroupAgreements: signedAs('octocat') });

      const card = fixture.debugElement.query(By.css('[data-testid="sign-identity-select-github-12345"]'));
      expect(card.injector.get(Tooltip, null)?.content).toBe(REASON);
      // The reason is also repeated where a screen reader will reach it — after the handle, so
      // which account is refused stays clear.
      expect(card.nativeElement.textContent).toContain('octocat');
      expect(card.nativeElement.textContent).toContain(REASON);
    });

    it('keeps the grayed card reachable, so the reason is not hover-only', async () => {
      await setup({ claGroupAgreements: signedAs('octocat') });

      // Removing it from the tab order would leave a keyboard-only contributor with no way to
      // ask why the account is unavailable — the tooltip also answers to focus, not just hover.
      const card = fixture.debugElement.query(By.css('[data-testid="sign-identity-select-github-12345"]'));
      expect(card.nativeElement.getAttribute('tabindex')).toBe('0');
      expect(card.injector.get(Tooltip, null)?.tooltipEvent).toBe('both');
    });

    it.each([
      ['Enter', 'Enter'],
      ['Space', ' '],
    ])('refuses a %s keypress on the grayed card', async (_label, key) => {
      await setup({ claGroupAgreements: signedAs('octocat') });

      // Keeping the card focusable put Enter/Space on a live path: the only thing that stops it
      // selecting the account is the card's own disabled guard, so assert the key leaves the
      // control exactly as it was rather than trusting that guard to stay.
      const identity = (fixture.componentInstance as any).selectForm.controls.identity;
      const before = identity.value;

      fixture.debugElement
        .query(By.css('[data-testid="sign-identity-select-github-12345"]'))
        .nativeElement.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      fixture.detectChanges();
      await fixture.whenStable();
      (fixture.componentInstance as any).onContinue();

      expect(identity.value).toBe(before);
      expect(close).not.toHaveBeenCalled();
    });

    it('refuses to submit it even if the card is reached another way', async () => {
      await setup({ claGroupAgreements: signedAs('octocat') });

      // Clicking a grayed card is refused by the card itself, which leaves the control unwritten
      // and never reaches the guard this test is named for. Writing the control directly is the
      // "another way" — it is what a refactor that drops the guard would silently allow.
      (fixture.componentInstance as any).selectForm.controls.identity.setValue('12345');
      fixture.detectChanges();
      await fixture.whenStable();
      (fixture.componentInstance as any).onContinue();

      expect(close).not.toHaveBeenCalled();
    });

    it('still lets them sign with their other account', async () => {
      await setup({ claGroupAgreements: signedAs('octocat') });

      await choose('sign-identity-select-github-67890');
      (fixture.componentInstance as any).onContinue();

      expect(close).toHaveBeenCalledWith({ kind: 'github', githubId: '67890' });
    });

    it('grays out the Gerrit card when the group was signed under the LF identity', async () => {
      await setup({ variant: 'github-or-gerrit', gerritUsername: GERRIT_USER, claGroupAgreements: signedAs('jdoe', 'gerrit') });

      expect(query('sign-identity-select-gerrit')?.getAttribute('aria-disabled')).toBe('true');
      // A Gerrit signature says nothing about their GitHub accounts.
      expect(query('sign-identity-select-github-12345')?.getAttribute('aria-disabled')).toBe('false');
    });

    it('leaves every card selectable when the agreement is on another CLA group', async () => {
      await setup({ claGroupAgreements: [] });

      expect(query('sign-identity-select-github-12345')?.getAttribute('aria-disabled')).toBe('false');
      expect(query('sign-identity-select-github-67890')?.getAttribute('aria-disabled')).toBe('false');
    });
  });
});
