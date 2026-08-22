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
    expect(close).toHaveBeenCalledWith(HUBOT.githubId);
  });

  it('closes with the later choice when the contributor changes their mind', async () => {
    await choose(OCTOCAT.githubId);
    await choose(HUBOT.githubId);
    (fixture.componentInstance as any).onContinue();

    expect(close).toHaveBeenCalledWith(HUBOT.githubId);
  });

  it('closes with nothing when the contributor backs out', async () => {
    await choose(OCTOCAT.githubId);
    (fixture.componentInstance as any).onCancel();

    // Null rather than the selection: the caller treats any account number as consent to
    // record it, so a cancel that leaked one would bind an association nobody confirmed.
    expect(close).toHaveBeenCalledWith(null);
  });

  it('renders without a choice when opened with no accounts', async () => {
    // Should not happen — the caller routes an empty list into account linking — but an empty
    // picker must not offer a Continue that could submit nothing.
    await setup([]);

    (fixture.componentInstance as any).onContinue();

    expect(close).not.toHaveBeenCalled();
  });
});
