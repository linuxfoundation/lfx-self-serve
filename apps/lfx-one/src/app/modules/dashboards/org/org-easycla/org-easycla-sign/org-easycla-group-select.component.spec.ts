// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { CCLA_SIGN_COPY, CLA_GROUP_SEARCH_MIN_CHARS } from '@lfx-one/shared/constants';
import type { ClaGroupOption, ClaGroupSearchResponse } from '@lfx-one/shared/interfaces';
import { OrgLensClaService } from '@services/org-lens-cla.service';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OrgEasyclaGroupSelectComponent } from './org-easycla-group-select.component';

/**
 * The Organization Lens CLA Group picker.
 *
 * The searching itself is the Me-lens picker's debounce and minimum-term behaviour and is covered
 * there. What is new — and what these specs are for — is that this picker keeps rows it cannot
 * sign, says why, and refuses to return one.
 */
describe('OrgEasyclaGroupSelectComponent', () => {
  const getSignOptions = vi.fn();
  const close = vi.fn();
  const orgUid = '0014100000Te0xxAAC';

  // Not cast. A cast would let a fixture omit a field the shared view mapper reads, and the
  // failure would surface as an unrelated runtime error rather than a type error here.
  const signable: ClaGroupOption = {
    claGroupId: '11111111-1111-4111-8111-111111111111',
    claGroupName: 'Cascade CLA',
    projectName: 'Cascade',
    projectSfid: 'a09410000182dD2AAI',
    cclaEnabled: true,
    iclaEnabled: true,
    matchTypes: ['project'],
    organizations: [],
  };

  /** A CLA Group covering several projects: the producer cannot be told which one to sign for. */
  const multiProject: ClaGroupOption = {
    claGroupId: '22222222-2222-4222-8222-222222222222',
    claGroupName: 'Driftwood Umbrella CLA',
    projectName: 'Driftwood Umbrella',
    cclaEnabled: true,
    iclaEnabled: true,
    matchTypes: ['project'],
    organizations: [],
  };

  /** Reached by pasting a repository address: nothing in the names carries the term that found it. */
  const repositoryMatch: ClaGroupOption = {
    claGroupId: '44444444-4444-4444-8444-444444444444',
    claGroupName: 'Cascade CLA',
    projectName: 'Cascade',
    projectSfid: 'a09410000182dD4AAI',
    cclaEnabled: true,
    iclaEnabled: true,
    matchTypes: ['repository'],
    matchedRepositoryName: 'acme-org/waterfall-sdk',
    organizations: [],
  };

  /** A CLA Group configured for individual agreements only. */
  const individualOnly: ClaGroupOption = {
    claGroupId: '33333333-3333-4333-8333-333333333333',
    claGroupName: 'Beacon ICLA-only CLA',
    projectName: 'Beacon',
    projectSfid: 'a09410000182dD3AAI',
    cclaEnabled: false,
    iclaEnabled: true,
    matchTypes: ['project'],
    organizations: [],
  };

  function results(options: ClaGroupOption[], truncated = false, searchTerm = 'cascade'): ClaGroupSearchResponse {
    return { results: options, truncated, searchTerm, resultCount: options.length };
  }

  async function render(): Promise<ComponentFixture<OrgEasyclaGroupSelectComponent>> {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [OrgEasyclaGroupSelectComponent],
      providers: [
        provideNoopAnimations(),
        { provide: DynamicDialogRef, useValue: { close } },
        { provide: DynamicDialogConfig, useValue: { data: { orgUid } } },
        { provide: OrgLensClaService, useValue: { getSignOptions } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(OrgEasyclaGroupSelectComponent);
    fixture.detectChanges();
    return fixture;
  }

  /** Types a searchable term and lets the debounce elapse. */
  async function search(fixture: ComponentFixture<OrgEasyclaGroupSelectComponent>, term = 'cascade'): Promise<void> {
    const form = (fixture.componentInstance as unknown as { searchForm: { controls: { query: { setValue: (v: string) => void } } } }).searchForm;
    form.controls.query.setValue(term);
    await vi.advanceTimersByTimeAsync(600);
    fixture.detectChanges();
  }

  function testid(fixture: ComponentFixture<OrgEasyclaGroupSelectComponent>, id: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(`[data-testid="${id}"]`);
  }

  function row(fixture: ComponentFixture<OrgEasyclaGroupSelectComponent>, option: ClaGroupOption): HTMLElement {
    return testid(fixture, `org-easycla-group-select-${option.claGroupId}`) as HTMLElement;
  }

  function continueButton(fixture: ComponentFixture<OrgEasyclaGroupSelectComponent>): HTMLButtonElement {
    return testid(fixture, 'org-easycla-group-continue')?.querySelector('button') as HTMLButtonElement;
  }

  /** The focused element, and so the only one whose ARIA state assistive technology announces. */
  function searchBoxOf(fixture: ComponentFixture<OrgEasyclaGroupSelectComponent>): HTMLInputElement {
    return fixture.nativeElement.querySelector('#org-easycla-group-select-search-input') as HTMLInputElement;
  }

  // jsdom implements no layout, so it ships no `scrollIntoView` at all — an unstubbed arrow press
  // throws before the assertion is reached. Stubbed on the prototype rather than per element
  // because the highlight scrolls on every arrow press, not on one deep-linked element.
  const scrollIntoView = vi.fn();
  beforeEach(() => {
    vi.useFakeTimers();
    getSignOptions.mockReset();
    close.mockClear();
    scrollIntoView.mockClear();
    Element.prototype.scrollIntoView = scrollIntoView;
  });

  afterEach(() => vi.useRealTimers());

  it('uses the M3 prototype copy, not a paraphrase of it', async () => {
    const fixture = await render();

    expect(testid(fixture, 'org-easycla-group-select-dialog')?.querySelector('p')?.textContent?.trim()).toBe(CCLA_SIGN_COPY.picker.body);
    expect(testid(fixture, 'org-easycla-group-select-search')?.querySelector('input')?.getAttribute('placeholder')).toBe(CCLA_SIGN_COPY.picker.placeholder);
    expect(testid(fixture, 'org-easycla-group-select-empty')?.textContent?.trim()).toBe(CCLA_SIGN_COPY.picker.empty);
    expect(continueButton(fixture).textContent?.trim()).toBe(CCLA_SIGN_COPY.picker.continueLabel);
  });

  it('searches the viewing organization, not the whole platform', async () => {
    getSignOptions.mockReturnValue(of(results([signable])));

    const fixture = await render();
    await search(fixture, 'cascade');

    expect(getSignOptions).toHaveBeenCalledWith(orgUid, 'cascade');
  });

  it('does not search before the minimum term length', async () => {
    getSignOptions.mockReturnValue(of(results([signable])));

    const fixture = await render();
    await search(fixture, 'ca'.slice(0, CLA_GROUP_SEARCH_MIN_CHARS - 1));

    expect(getSignOptions).not.toHaveBeenCalled();
    expect(testid(fixture, 'org-easycla-group-select-keep-typing')).not.toBeNull();
  });

  it('offers a signable CLA group without a reason against it', async () => {
    getSignOptions.mockReturnValue(of(results([signable])));

    const fixture = await render();
    await search(fixture);

    expect(row(fixture, signable)).not.toBeNull();
    expect(row(fixture, signable).getAttribute('aria-disabled')).toBe('false');
    expect(testid(fixture, `org-easycla-group-disabled-${signable.claGroupId}`)).toBeNull();
  });

  // A row that cannot be signed stays on screen. Filtering it out would leave the viewer
  // searching again for a CLA Group they can see in the legacy console, with no explanation.
  it('keeps a multi-project CLA group visible and says why it cannot be signed here', async () => {
    getSignOptions.mockReturnValue(of(results([multiProject])));

    const fixture = await render();
    await search(fixture, 'driftwood');

    expect(row(fixture, multiProject).getAttribute('aria-disabled')).toBe('true');
    expect(testid(fixture, `org-easycla-group-disabled-${multiProject.claGroupId}`)?.textContent).toContain(CCLA_SIGN_COPY.picker.multiProjectDisabledReason);
  });

  it('keeps an individual-only CLA group visible and says why it cannot be signed corporately', async () => {
    getSignOptions.mockReturnValue(of(results([individualOnly])));

    const fixture = await render();
    await search(fixture, 'beacon');

    expect(row(fixture, individualOnly).getAttribute('aria-disabled')).toBe('true');
    expect(testid(fixture, `org-easycla-group-disabled-${individualOnly.claGroupId}`)?.textContent).toContain(CCLA_SIGN_COPY.picker.cclaDisabledReason);
  });

  // The reason is visible text inside the option, not a tooltip: a tooltip never reaches anyone
  // who cannot hover, and inside the option it becomes part of the row's accessible name, so it
  // is read out when the keyboard highlight arrives.
  it('states the reason as text on the row itself', async () => {
    getSignOptions.mockReturnValue(of(results([multiProject])));

    const fixture = await render();
    await search(fixture, 'driftwood');

    const reason = testid(fixture, `org-easycla-group-disabled-${multiProject.claGroupId}`);
    expect(reason?.textContent?.trim()).toBeTruthy();
    expect(row(fixture, multiProject).contains(reason)).toBe(true);
  });

  it('names the repository a pasted address resolved to, on the row it produced', async () => {
    getSignOptions.mockReturnValue(of(results([repositoryMatch], false, 'https://github.com/acme-org/waterfall-sdk')));

    const fixture = await render();
    await search(fixture, 'https://github.com/acme-org/waterfall-sdk');

    // On the row, not merely somewhere in the dialog: it has to be part of the option's accessible
    // name, so the highlight reads it out along with the names it does not resemble.
    const matched = testid(fixture, `org-easycla-group-matched-repo-${repositoryMatch.claGroupId}`);
    expect(matched?.textContent).toContain('acme-org/waterfall-sdk');
    expect(row(fixture, repositoryMatch).contains(matched)).toBe(true);
  });

  it('does not claim a repository match on a row found by name', async () => {
    getSignOptions.mockReturnValue(of(results([signable])));

    const fixture = await render();
    await search(fixture);

    expect(testid(fixture, `org-easycla-group-matched-repo-${signable.claGroupId}`)).toBeNull();
  });

  it('cannot be continued before a CLA group is chosen', async () => {
    getSignOptions.mockReturnValue(of(results([signable])));

    const fixture = await render();
    await search(fixture);

    expect(continueButton(fixture).disabled).toBe(true);
  });

  it('returns the chosen CLA group with the project it will be signed for', async () => {
    getSignOptions.mockReturnValue(of(results([signable])));

    const fixture = await render();
    await search(fixture);
    row(fixture, signable).click();
    fixture.detectChanges();
    continueButton(fixture).click();

    expect(close).toHaveBeenCalledWith({
      claGroupId: signable.claGroupId,
      projectSfid: signable.projectSfid,
      projectName: signable.projectName,
    });
  });

  // Clicking a disabled row must not select it. The template's own disabled state is not the only
  // guard, because a keyboard activation does not consult a CSS class.
  it('does not choose a CLA group that cannot be signed', async () => {
    getSignOptions.mockReturnValue(of(results([multiProject])));

    const fixture = await render();
    await search(fixture, 'driftwood');
    row(fixture, multiProject).click();
    fixture.detectChanges();

    expect(continueButton(fixture).disabled).toBe(true);
    expect(close).not.toHaveBeenCalled();
  });

  // A typed character invalidates the confirmed choice, so the continue control can never
  // describe a CLA Group the field no longer matches.
  it('discards the choice when the search is edited', async () => {
    getSignOptions.mockReturnValue(of(results([signable])));

    const fixture = await render();
    await search(fixture);
    row(fixture, signable).click();
    fixture.detectChanges();
    expect(continueButton(fixture).disabled).toBe(false);

    await search(fixture, 'cascade rewritten');

    expect(continueButton(fixture).disabled).toBe(true);
  });

  it('distinguishes "nothing matched" from "keep typing"', async () => {
    getSignOptions.mockReturnValue(of(results([])));

    const fixture = await render();
    await search(fixture, 'nothingmatches');

    expect(testid(fixture, 'org-easycla-group-select-no-match')?.textContent?.trim()).toBe(CCLA_SIGN_COPY.picker.noMatch);
    expect(testid(fixture, 'org-easycla-group-select-keep-typing')).toBeNull();
  });

  it('says when more matched than it can show', async () => {
    getSignOptions.mockReturnValue(of(results([signable], true)));

    const fixture = await render();
    await search(fixture);

    expect(testid(fixture, 'org-easycla-group-select-truncated')).not.toBeNull();
  });

  it('offers a retry when the search fails rather than reading as no matches', async () => {
    getSignOptions.mockReturnValue(throwError(() => new Error('gateway')));

    const fixture = await render();
    await search(fixture);

    expect(testid(fixture, 'org-easycla-group-select-error')).not.toBeNull();
    expect(testid(fixture, 'org-easycla-group-select-no-match')).toBeNull();
  });

  it('recovers when a retried search succeeds', async () => {
    getSignOptions.mockReturnValueOnce(throwError(() => new Error('gateway'))).mockReturnValue(of(results([signable])));

    const fixture = await render();
    await search(fixture);
    (fixture.componentInstance as unknown as { retry: () => void }).retry();
    await vi.advanceTimersByTimeAsync(600);
    fixture.detectChanges();

    expect(testid(fixture, 'org-easycla-group-select-error')).toBeNull();
    expect(row(fixture, signable)).not.toBeNull();
  });

  it('closes with nothing when the viewer backs out', async () => {
    getSignOptions.mockReturnValue(of(results([signable])));

    const fixture = await render();
    (testid(fixture, 'org-easycla-group-cancel')?.querySelector('button') as HTMLButtonElement).click();

    expect(close).toHaveBeenCalledWith(null);
  });

  /**
   * The rows carry `role="option"` on plain elements, which are not focusable and have no
   * activation behaviour of their own. Without the handling below there is no way to choose a CLA
   * Group without a pointer — the flow is simply unavailable to a keyboard-only signatory.
   *
   * The highlight roves from the text box, which keeps focus, so the combobox attributes have to
   * be on the text box: `aria-activedescendant` is read from the focused element, and on the
   * listbox — which nothing ever focuses — it names the right row and is never announced. These
   * assertions therefore read the input, not the list. Asserting against the list is how the
   * first version of this passed while being silent to every screen reader.
   */
  describe('keyboard', () => {
    function press(fixture: ComponentFixture<OrgEasyclaGroupSelectComponent>, key: string): void {
      testid(fixture, 'org-easycla-group-select-results')?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      fixture.detectChanges();
    }

    function results_(fixture: ComponentFixture<OrgEasyclaGroupSelectComponent>): HTMLElement {
      return testid(fixture, 'org-easycla-group-select-results') as HTMLElement;
    }

    it('chooses the highlighted CLA group on Enter', async () => {
      getSignOptions.mockReturnValue(of(results([signable])));

      const fixture = await render();
      await search(fixture);
      press(fixture, 'ArrowDown');
      press(fixture, 'Enter');
      continueButton(fixture).click();

      expect(close).toHaveBeenCalledWith({
        claGroupId: signable.claGroupId,
        projectSfid: signable.projectSfid,
        projectName: signable.projectName,
      });
    });

    // Focus stays on the search box throughout the combobox pattern, so the browser scrolls
    // nothing of its own when the highlight moves. Past the handful of rows the 240px list can
    // show, a sighted keyboard user would lose sight of which row Enter is about to choose — and
    // a screen-reader user would notice nothing wrong, which is what makes it easy to ship.
    it('brings the newly highlighted row into view on each arrow press', async () => {
      getSignOptions.mockReturnValue(of(results([signable, multiProject])));

      const fixture = await render();
      await search(fixture);
      press(fixture, 'ArrowDown');
      press(fixture, 'ArrowDown');

      expect(scrollIntoView).toHaveBeenCalledTimes(2);
      // `nearest` so a row already visible does not scroll; anything else jumps the list under the
      // reader on every press.
      expect(scrollIntoView).toHaveBeenLastCalledWith({ block: 'nearest' });
    });

    // The wiring that makes the highlight audible at all. Without `role="combobox"` and
    // `aria-controls` on the focused input, `aria-activedescendant` on it has nothing to resolve
    // against and assistive technology has no reason to look for a list.
    it('declares the input a combobox controlling the results list', async () => {
      getSignOptions.mockReturnValue(of(results([signable])));

      const fixture = await render();
      const input = () => searchBoxOf(fixture);

      expect(input().getAttribute('role')).toBe('combobox');
      expect(input().getAttribute('aria-autocomplete')).toBe('list');
      expect(input().getAttribute('aria-controls')).toBe('org-easycla-group-select-results');
      expect(results_(fixture).id).toBe('org-easycla-group-select-results');

      // Before a search there is nothing to expand into; after one there is.
      expect(input().getAttribute('aria-expanded')).toBe('false');
      await search(fixture);
      expect(input().getAttribute('aria-expanded')).toBe('true');
    });

    it('names the highlighted row so a screen reader can follow the arrow keys', async () => {
      getSignOptions.mockReturnValue(of(results([signable])));

      const fixture = await render();
      await search(fixture);
      expect(searchBoxOf(fixture).getAttribute('aria-activedescendant')).toBeNull();

      press(fixture, 'ArrowDown');

      expect(searchBoxOf(fixture).getAttribute('aria-activedescendant')).toBe(`org-easycla-group-option-${signable.claGroupId}`);
      expect(row(fixture, signable).id).toBe(`org-easycla-group-option-${signable.claGroupId}`);
    });

    it('moves down and back up through the list', async () => {
      getSignOptions.mockReturnValue(of(results([signable, individualOnly])));

      const fixture = await render();
      await search(fixture);
      press(fixture, 'ArrowDown');
      press(fixture, 'ArrowDown');
      expect(searchBoxOf(fixture).getAttribute('aria-activedescendant')).toBe(`org-easycla-group-option-${individualOnly.claGroupId}`);

      press(fixture, 'ArrowUp');

      expect(searchBoxOf(fixture).getAttribute('aria-activedescendant')).toBe(`org-easycla-group-option-${signable.claGroupId}`);
    });

    // The highlight does stop on a row that cannot be signed, because the reason it cannot is the
    // row's whole payload and skipping past it would keep that from a keyboard-only viewer
    // entirely. Enter is what refuses.
    it('highlights a CLA group that cannot be signed but will not choose it', async () => {
      getSignOptions.mockReturnValue(of(results([multiProject])));

      const fixture = await render();
      await search(fixture, 'driftwood');
      press(fixture, 'ArrowDown');
      expect(searchBoxOf(fixture).getAttribute('aria-activedescendant')).toBe(`org-easycla-group-option-${multiProject.claGroupId}`);

      press(fixture, 'Enter');

      expect(continueButton(fixture).disabled).toBe(true);
      expect(close).not.toHaveBeenCalled();
    });

    // The highlight is a position in the previous list. Carried across a new search it would let
    // Enter confirm whichever CLA Group happens to land at that offset.
    it('drops the highlight when a new search arrives', async () => {
      getSignOptions.mockReturnValueOnce(of(results([signable, individualOnly]))).mockReturnValue(of(results([individualOnly])));

      const fixture = await render();
      await search(fixture);
      press(fixture, 'ArrowDown');
      press(fixture, 'ArrowDown');

      await search(fixture, 'beacon');

      expect(searchBoxOf(fixture).getAttribute('aria-activedescendant')).toBeNull();
    });

    it('backs out on Escape', async () => {
      getSignOptions.mockReturnValue(of(results([signable])));

      const fixture = await render();
      await search(fixture);
      press(fixture, 'Escape');

      expect(close).toHaveBeenCalledWith(null);
    });

    it('ignores Enter when the search failed and the rows are not on screen', async () => {
      getSignOptions.mockReturnValue(throwError(() => new Error('gateway')));

      const fixture = await render();
      await search(fixture);
      press(fixture, 'ArrowDown');
      press(fixture, 'Enter');

      expect(close).not.toHaveBeenCalled();
    });
  });

  /**
   * The window between a keystroke and the results that answer it.
   *
   * The rows for the previous term stay rendered across the debounce and the request that follows
   * it. If they stay choosable, a viewer can pick one in that window and the response that lands
   * afterwards swaps the list out from under a selection it never contained — and Continue then
   * opens a corporate agreement for a project the viewer had already started typing away from.
   *
   * These cases interleave typing and choosing deliberately. A test that only advances the clock
   * and asserts on the final list passes against the broken version, because the bug is not in
   * what is fetched: `switchMap` cancels the previous request correctly. It is in what remains
   * clickable while that happens.
   */
  describe('a search the viewer has moved on from', () => {
    /** Types without letting the debounce elapse, leaving the previous rows on screen. */
    function type(fixture: ComponentFixture<OrgEasyclaGroupSelectComponent>, term: string): void {
      const form = (fixture.componentInstance as unknown as { searchForm: { controls: { query: { setValue: (v: string) => void } } } }).searchForm;
      form.controls.query.setValue(term);
      fixture.detectChanges();
    }

    it('refuses a row clicked after the term it belongs to was changed', async () => {
      getSignOptions.mockReturnValueOnce(of(results([signable]))).mockReturnValue(of(results([individualOnly])));

      const fixture = await render();
      await search(fixture, 'cascade');
      expect(row(fixture, signable)).not.toBeNull();

      // Mid-word. `signable` is still drawn, and is now a result for a term nobody is searching.
      type(fixture, 'beacon');
      row(fixture, signable).click();
      fixture.detectChanges();

      expect(continueButton(fixture).disabled).toBe(true);

      // And it stays refused after the new results land, rather than being resurrected by them.
      await vi.advanceTimersByTimeAsync(600);
      fixture.detectChanges();
      expect(continueButton(fixture).disabled).toBe(true);
      expect(close).not.toHaveBeenCalled();
    });

    // The keyboard route to the same defect, and it needs the extra ArrowDown to be worth having.
    // Typing already resets the highlight, so an Enter pressed straight after it is refused for
    // that reason alone and the case would pass with no staleness handling at all. Re-highlighting
    // first puts the cursor back on a superseded row, which is the state only the guard refuses.
    it('refuses a re-highlighted superseded row on Enter, not only on click', async () => {
      getSignOptions.mockReturnValueOnce(of(results([signable]))).mockReturnValue(of(results([individualOnly])));

      const fixture = await render();
      await search(fixture, 'cascade');

      type(fixture, 'beacon');
      const key = (name: string) => {
        testid(fixture, 'org-easycla-group-select-results')?.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }));
        fixture.detectChanges();
      };
      key('ArrowDown');
      key('Enter');

      expect(continueButton(fixture).disabled).toBe(true);
      expect(close).not.toHaveBeenCalled();
      // The highlight is not announced either, so nothing reads out a row that cannot be chosen.
      expect(searchBoxOf(fixture).getAttribute('aria-activedescendant')).toBeNull();
    });

    it('marks the superseded rows as unavailable while they are still drawn', async () => {
      getSignOptions.mockReturnValueOnce(of(results([signable]))).mockReturnValue(of(results([individualOnly])));

      const fixture = await render();
      await search(fixture, 'cascade');
      expect(row(fixture, signable).getAttribute('aria-disabled')).toBe('false');

      type(fixture, 'beacon');

      expect(row(fixture, signable).getAttribute('aria-disabled')).toBe('true');
      // And the viewer is told why the rows stopped responding, rather than left guessing.
      expect(testid(fixture, 'org-easycla-group-select-pending')).not.toBeNull();
    });

    it('makes the rows choosable again once the results catch up with the term', async () => {
      getSignOptions.mockReturnValueOnce(of(results([individualOnly]))).mockReturnValue(of(results([signable], false, 'cascade')));

      const fixture = await render();
      await search(fixture, 'beacon');
      type(fixture, 'cascade');
      await vi.advanceTimersByTimeAsync(600);
      fixture.detectChanges();

      expect(testid(fixture, 'org-easycla-group-select-pending')).toBeNull();
      row(fixture, signable).click();
      fixture.detectChanges();
      continueButton(fixture).click();

      expect(close).toHaveBeenCalledWith({
        claGroupId: signable.claGroupId,
        projectSfid: signable.projectSfid,
        projectName: signable.projectName,
      });
    });

    // Choosing writes the CLA Group's name into the field, which is a value change like any
    // other. If that were treated as the viewer moving on, every selection would immediately
    // invalidate itself and Continue would never enable.
    it('does not treat writing the chosen name into the field as a new search', async () => {
      getSignOptions.mockReturnValue(of(results([signable])));

      const fixture = await render();
      await search(fixture, 'cascade');
      row(fixture, signable).click();
      fixture.detectChanges();

      expect(continueButton(fixture).disabled).toBe(false);
      expect(testid(fixture, 'org-easycla-group-select-pending')).toBeNull();
    });
  });
});
