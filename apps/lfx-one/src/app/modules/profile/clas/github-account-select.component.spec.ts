// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import type { GithubAccountOption } from '@lfx-one/shared/interfaces';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GithubAccountSelectComponent } from './github-account-select.component';

/**
 * Covers the GitHub account step opened by DialogService (#1252).
 *
 * The dialog holds no authority — the backend re-derives the attested set from the caller's own
 * token — so what these tests protect is the contributor's *choice*: that every linked account
 * is offered, that nothing is chosen on their behalf, and that the dialog closes with exactly
 * what they picked. Those three are what the parent depends on.
 *
 * With no linked account there is no choice to protect, and the tests turn to the block instead
 * (#1917): that the list and its actions are gone rather than merely disabled, and that asking
 * to link an account is distinguishable from walking away.
 */
describe('GithubAccountSelectComponent', () => {
  const OCTOCAT: GithubAccountOption = { githubId: '12345', githubUsername: 'octocat' };
  const HUBOT: GithubAccountOption = { githubId: '67890', githubUsername: 'hubot' };

  let fixture: ComponentFixture<GithubAccountSelectComponent>;
  let close: ReturnType<typeof vi.fn>;

  async function setup(accounts: GithubAccountOption[] = [OCTOCAT, HUBOT]): Promise<void> {
    TestBed.resetTestingModule();
    close = vi.fn();

    TestBed.configureTestingModule({
      imports: [GithubAccountSelectComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: DynamicDialogRef, useValue: { close } },
        { provide: DynamicDialogConfig, useValue: { data: { accounts } } },
      ],
    });

    fixture = TestBed.createComponent(GithubAccountSelectComponent);
    fixture.detectChanges();
    await fixture.whenStable();
  }

  function query(testId: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  }

  /** Picks a card the way a click does — the card writes the chosen value into the form. */
  async function choose(githubId: string): Promise<void> {
    query(`github-account-select-${githubId}`)?.click();
    fixture.detectChanges();
    await fixture.whenStable();
  }

  beforeEach(async () => {
    await setup();
  });

  it('offers every linked account', async () => {
    expect(query(`github-account-select-${OCTOCAT.githubId}`)).not.toBeNull();
    expect(query(`github-account-select-${HUBOT.githubId}`)).not.toBeNull();
  });

  it('shows the handle, since an account number means nothing to the contributor', async () => {
    expect(query(`github-account-select-${OCTOCAT.githubId}`)?.textContent).toContain('octocat');
  });

  it('falls back to the account number when the handle is blank, so the row is still identifiable', async () => {
    // The server maps a missing Auth0 nickname to '' rather than guessing a handle. Rendered
    // as-is that produces an unlabelled row, which is unusable in the one situation this
    // dialog is shown at all — a contributor choosing between two accounts.
    const NAMELESS: GithubAccountOption = { githubId: '55555', githubUsername: '' };
    await setup([OCTOCAT, NAMELESS]);

    expect(query(`github-account-select-${NAMELESS.githubId}`)?.textContent).toContain('55555');
  });

  it('preselects nothing', async () => {
    // A preselection is indistinguishable from a choice once submitted, and this step exists
    // precisely so the association stops being decided by list order.
    expect((fixture.componentInstance as any).selectedId()).toBeNull();
  });

  it('does not close until an account is chosen', async () => {
    (fixture.componentInstance as any).onContinue();

    expect(close).not.toHaveBeenCalled();
  });

  it('closes with the account number the contributor picked', async () => {
    await choose(HUBOT.githubId);
    (fixture.componentInstance as any).onContinue();

    // The number, not the handle: handles get renamed and reclaimed by other people, so a
    // hand-off keyed on one could land on a different account than the one shown here.
    expect(close).toHaveBeenCalledWith({ githubId: HUBOT.githubId });
  });

  it('closes with the later choice when the contributor changes their mind', async () => {
    await choose(OCTOCAT.githubId);
    await choose(HUBOT.githubId);
    (fixture.componentInstance as any).onContinue();

    expect(close).toHaveBeenCalledWith({ githubId: HUBOT.githubId });
  });

  it('closes with nothing when the contributor backs out', async () => {
    await choose(OCTOCAT.githubId);
    (fixture.componentInstance as any).onCancel();

    // Null rather than the selection: the caller treats any account number as consent to
    // record it, so a cancel that leaked one would bind an association nobody confirmed.
    expect(close).toHaveBeenCalledWith(null);
  });

  // --- Empty state (#1917) --------------------------------------------------

  it('blocks with an empty state instead of an empty list when nothing is linked', async () => {
    await setup([]);

    // The list and both footer actions give way to the empty state, so there is no Continue to
    // press and nothing to press it against — the block is structural, not a disabled button.
    expect(query('github-account-select-empty')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[role="listbox"]')).toBeNull();
    expect(query('github-account-select-continue')).toBeNull();
    expect(query('github-account-select-cancel')).toBeNull();
  });

  it('says which accounts are missing and where to link one', async () => {
    await setup([]);

    expect(query('github-account-select-empty')?.textContent).toContain('No GitHub accounts are connected to your profile yet');
    expect(query('github-account-select-link-accounts')?.textContent).toContain('Go to Identities');
  });

  it('keeps the group explanation above the empty state, as the design leaves it', async () => {
    await setup([]);

    // The design shows this paragraph at every account count, and its first sentence is the only
    // place the flow says why a GitHub account in particular is being asked for. Dropping it
    // because the second sentence reads oddly with nothing to choose from would be a rewrite of
    // copy that is taken verbatim, so it stays and this holds it there.
    expect(query('github-account-select-dialog')?.textContent).toContain('This CLA group is linked to GitHub repositories');
  });

  it('asks the caller to open Identities rather than navigating itself', async () => {
    await setup([]);

    query('github-account-select-link-accounts')?.querySelector('button')?.click();

    // Distinguishable from the dismissal below, which is the whole reason it is not just a
    // close: only one of the two should move the contributor off the page they started from.
    expect(close).toHaveBeenCalledWith({ linkAccounts: true });
  });

  it('cannot submit an account from the empty state', async () => {
    await setup([]);

    (fixture.componentInstance as any).onContinue();

    expect(close).not.toHaveBeenCalled();
  });
});
