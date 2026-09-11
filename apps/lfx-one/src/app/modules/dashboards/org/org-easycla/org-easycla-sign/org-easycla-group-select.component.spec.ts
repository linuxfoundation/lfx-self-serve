// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { CCLA_SIGN_COPY, CLA_GROUP_MATCH_TYPE_LABELS, CLA_GROUP_SEARCH_MIN_CHARS } from '@lfx-one/shared/constants';
import type { ClaGroupOption, ClaGroupSearchResponse, OrgClaGroup } from '@lfx-one/shared/interfaces';
import { OrgLensClaService } from '@services/org-lens-cla.service';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { of, Subject, throwError } from 'rxjs';
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

  /** One row of the organization's own CLA list, as the page hands it down. */
  function held(claGroupId: string): OrgClaGroup {
    return {
      id: 'signature-uuid-1',
      claGroupId,
      claGroupName: 'Cascade CLA',
      projects: [{ projectName: 'Cascade', projectSfid: 'a09410000182dD2AAI' }],
      signed: true,
      status: 'signed',
      needsClaManager: false,
      claManagersCount: 1,
    };
  }

  async function render(claGroups: OrgClaGroup[] = []): Promise<ComponentFixture<OrgEasyclaGroupSelectComponent>> {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [OrgEasyclaGroupSelectComponent],
      providers: [
        provideNoopAnimations(),
        { provide: DynamicDialogRef, useValue: { close } },
        { provide: DynamicDialogConfig, useValue: { data: { orgUid, claGroups } } },
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
    expect(searchBoxOf(fixture).getAttribute('placeholder')).toBe(CCLA_SIGN_COPY.picker.placeholder);
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

  /**
   * A CLA Group the organization already holds a corporate agreement for.
   *
   * Left selectable, Continue carries the viewer to a preview headed "«Org» has not yet signed a
   * CLA for «Group»" — a false statement about an agreement that exists — and offers to sign it
   * again. The refusal is what stops that, so these cases assert the row, the reason, and that
   * neither pointer nor keyboard can get past it.
   */
  describe('a CLA group the organization has already signed', () => {
    it('keeps the row visible and says the organization already holds one', async () => {
      getSignOptions.mockReturnValue(of(results([signable])));

      const fixture = await render([held(signable.claGroupId)]);
      await search(fixture);

      expect(row(fixture, signable).getAttribute('aria-disabled')).toBe('true');
      expect(testid(fixture, `org-easycla-group-disabled-${signable.claGroupId}`)?.textContent).toContain(CCLA_SIGN_COPY.picker.alreadySignedDisabledReason);
    });

    it('cannot be chosen by pointer or by keyboard', async () => {
      getSignOptions.mockReturnValue(of(results([signable])));

      const fixture = await render([held(signable.claGroupId)]);
      await search(fixture);
      row(fixture, signable).click();
      testid(fixture, 'org-easycla-group-select-results')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      testid(fixture, 'org-easycla-group-select-results')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      fixture.detectChanges();

      expect(continueButton(fixture).disabled).toBe(true);
      expect(close).not.toHaveBeenCalled();
    });

    /**
     * EasyCLA accepts hyphenated, unhyphenated and mixed-case spellings of the same UUID, and the
     * two sides of this comparison come from different endpoints — the organization's CLA list and
     * the CLA Group search. A raw `===` passes every test written with one spelling on both sides
     * and misses the real match in production, which is the whole failure this guards.
     */
    it('matches the held agreement across UUID spellings, not by string equality', async () => {
      getSignOptions.mockReturnValue(of(results([signable])));

      const fixture = await render([held(signable.claGroupId.replaceAll('-', '').toUpperCase())]);
      await search(fixture);

      expect(row(fixture, signable).getAttribute('aria-disabled')).toBe('true');
      expect(testid(fixture, `org-easycla-group-disabled-${signable.claGroupId}`)?.textContent).toContain(CCLA_SIGN_COPY.picker.alreadySignedDisabledReason);
    });

    // The other half of the check: holding *an* agreement must not refuse every row, or the
    // picker becomes unusable for any organization that has signed anything.
    it('leaves a CLA group the organization does not hold selectable', async () => {
      getSignOptions.mockReturnValue(of(results([signable])));

      const fixture = await render([held(individualOnly.claGroupId)]);
      await search(fixture);
      row(fixture, signable).click();
      fixture.detectChanges();

      expect(testid(fixture, `org-easycla-group-disabled-${signable.claGroupId}`)).toBeNull();
      expect(continueButton(fixture).disabled).toBe(false);
    });

    // Answered before "covers several projects", which is the less useful of the two: a CLA Group
    // signed through the legacy console can still be one this flow could not have signed itself.
    it('names the held agreement ahead of the reason this flow could not have signed it', async () => {
      getSignOptions.mockReturnValue(of(results([multiProject])));

      const fixture = await render([held(multiProject.claGroupId)]);
      await search(fixture, 'driftwood');

      const reason = testid(fixture, `org-easycla-group-disabled-${multiProject.claGroupId}`)?.textContent;
      expect(reason).toContain(CCLA_SIGN_COPY.picker.alreadySignedDisabledReason);
      expect(reason).not.toContain(CCLA_SIGN_COPY.picker.multiProjectDisabledReason);
    });
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

  it('names why the row matched, the same way My CLA does', async () => {
    getSignOptions.mockReturnValue(of(results([signable])));

    const fixture = await render();
    await search(fixture);

    expect(testid(fixture, `org-easycla-group-match-types-${signable.claGroupId}`)?.textContent).toContain(CLA_GROUP_MATCH_TYPE_LABELS.project);
    expect(row(fixture, signable).textContent).toContain('Cascade');
    expect(row(fixture, signable).textContent).toContain('Cascade CLA');
  });

  it('names a single linked organization on the row', async () => {
    const withOrg: ClaGroupOption = {
      ...signable,
      organizations: [{ name: 'acme-org', source: 'github' }],
    };
    getSignOptions.mockReturnValue(of(results([withOrg])));

    const fixture = await render();
    await search(fixture);

    const org = testid(fixture, `org-easycla-group-org-${withOrg.claGroupId}`);
    expect(org?.textContent).toContain('acme-org');
    expect(org?.textContent).toContain('GitHub');
    expect(row(fixture, withOrg).contains(org)).toBe(true);
  });

  it('expands several linked orgs without choosing the row', async () => {
    const withOrgs: ClaGroupOption = {
      ...signable,
      organizations: [
        { name: 'acme-org', source: 'github' },
        { name: 'acme-gitlab', source: 'gitlab' },
      ],
    };
    getSignOptions.mockReturnValue(of(results([withOrgs])));

    const fixture = await render();
    await search(fixture);

    const toggle = testid(fixture, `org-easycla-group-orgs-toggle-${withOrgs.claGroupId}`);
    expect(toggle?.textContent).toContain('2 linked orgs');
    expect(row(fixture, withOrgs).contains(toggle)).toBe(false);
    expect(testid(fixture, `org-easycla-group-orgs-${withOrgs.claGroupId}`)).toBeNull();

    toggle?.click();
    fixture.detectChanges();

    expect(testid(fixture, `org-easycla-group-orgs-${withOrgs.claGroupId}`)?.textContent).toContain('acme-gitlab');
    expect(continueButton(fixture).disabled).toBe(true);
    expect(close).not.toHaveBeenCalled();

    const listbox = testid(fixture, 'org-easycla-group-select-results');
    listbox?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    fixture.detectChanges();

    toggle?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    fixture.detectChanges();
    expect(continueButton(fixture).disabled).toBe(true);
    expect(close).not.toHaveBeenCalled();

    listbox?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    fixture.detectChanges();
    expect(continueButton(fixture).disabled).toBe(false);
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
      claGroupName: signable.claGroupName,
      orgUid,
    });
  });

  /**
   * The name the preview page heads itself with, when search named no CLA Group.
   *
   * That page cannot look it up again — there is no fetch-a-CLA-group-by-id endpoint — so a blank
   * here becomes a preview headed by nothing, offering to start a legal agreement it cannot name.
   */
  it('falls back to the row’s own primary line when search named no CLA Group', async () => {
    const unnamed: ClaGroupOption = { ...signable, claGroupName: undefined };
    getSignOptions.mockReturnValue(of(results([unnamed])));

    const fixture = await render();
    await search(fixture);
    row(fixture, unnamed).click();
    fixture.detectChanges();
    continueButton(fixture).click();

    expect(close).toHaveBeenCalledWith(expect.objectContaining({ claGroupName: unnamed.projectName }));
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

    expect(testid(fixture, 'org-easycla-group-select-truncated')?.textContent?.trim()).toBe(
      'More projects matched than we can show. Narrow the search to see the rest.'
    );
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
        claGroupName: signable.claGroupName,
        orgUid,
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

      // Before a search there is nothing to expand into; after one there is.
      expect(input().getAttribute('aria-expanded')).toBe('false');
      await search(fixture);
      expect(input().getAttribute('aria-expanded')).toBe('true');
      // The `aria-controls` target only exists when there is a listbox to point at, and it carries
      // `role="listbox"` — not the surrounding scroll panel, which owns non-option status content
      // (error + Retry, keep-typing, stale banner) that a listbox cannot legally contain.
      const listbox = results_(fixture);
      expect(listbox.id).toBe('org-easycla-group-select-results');
      expect(listbox.getAttribute('role')).toBe('listbox');
      expect(listbox.getAttribute('aria-label')).toBe('Matching projects');
    });

    /**
     * ARIA listbox is allowed to contain options (and optgroups of options), and nothing else.
     * The panel used to wrap the error message, the Retry button, the keep-typing hint, the
     * loading spinner, the no-match copy, the stale-search banner, and the "more matched than can
     * be shown" note all inside the listbox. Screen readers either dropped those or announced
     * them as broken options; the Retry button in particular was reached by pointer only.
     *
     * Two shapes are checked here — an error state and a searchable-with-options state — because
     * the regression is that a status widget re-enters the listbox subtree. A single option-only
     * snapshot would pass against the broken version if the error state were the one restructured
     * and the results state left inside a listbox with its status siblings.
     */
    it('keeps non-option content out of the listbox in every state', async () => {
      getSignOptions.mockReturnValue(throwError(() => new Error('gateway')));

      const fixture = await render();
      await search(fixture);

      // In error state, there is no listbox at all. The error and its Retry button are alongside
      // the search box under the scroll panel.
      expect(fixture.nativeElement.querySelector('[role="listbox"]')).toBeNull();
      expect(testid(fixture, 'org-easycla-group-select-error')).not.toBeNull();
      expect(testid(fixture, 'org-easycla-group-select-retry')).not.toBeNull();
    });

    it('keeps the stale banner and the truncated note as siblings of the listbox, not inside it', async () => {
      const many = Array.from({ length: 26 }, (_, index) => ({ ...signable, claGroupId: `cla-${index}`, projectSfid: `sfid-${index}` }));
      getSignOptions.mockReturnValue(of(results(many, true)));

      const fixture = await render();
      await search(fixture);

      const listbox = results_(fixture);
      for (const child of Array.from(listbox.children)) {
        expect(child.querySelectorAll('[role="option"]').length).toBe(1);
      }

      // And the "more matched than can be shown" note sits *outside* the listbox, in the panel.
      const truncated = testid(fixture, 'org-easycla-group-select-truncated');
      expect(truncated).not.toBeNull();
      expect(listbox.contains(truncated as Node)).toBe(false);
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

    // No row is on before the first key press. Down lands on the first row and Up lands on the
    // last — the expected entry points into a list a viewer has not touched yet. A modular step
    // from the empty state would land on `length - 2` for Up, which reads to a screen-reader
    // user as "the second-to-last CLA Group is highlighted" for no reason they typed.
    it('lands on the first row on Down and the last row on Up from the fresh list', async () => {
      getSignOptions.mockReturnValue(of(results([signable, individualOnly, multiProject])));

      const fixture = await render();
      await search(fixture);
      press(fixture, 'ArrowDown');
      expect(searchBoxOf(fixture).getAttribute('aria-activedescendant')).toBe(`org-easycla-group-option-${signable.claGroupId}`);
    });

    it('lands on the last row on the first Up from the fresh list', async () => {
      getSignOptions.mockReturnValue(of(results([signable, individualOnly, multiProject])));

      const fixture = await render();
      await search(fixture);
      press(fixture, 'ArrowUp');
      expect(searchBoxOf(fixture).getAttribute('aria-activedescendant')).toBe(`org-easycla-group-option-${multiProject.claGroupId}`);
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
        claGroupName: signable.claGroupName,
        orgUid,
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

  /**
   * Screen-reader users hear the transitions the sighted viewer sees: search starting, no
   * matches, results arrived, truncation, and load failures. Focus stays in the input, so a
   * text swap elsewhere is not announced without a live region. `polite` and `atomic` are the
   * two ARIA choices worth pinning \u2014 an assertive region would interrupt, and a non-atomic
   * one would leave stale fragments behind.
   */
  describe('polite announcements for a screen-reader user', () => {
    function live(fixture: ComponentFixture<OrgEasyclaGroupSelectComponent>): HTMLElement {
      return testid(fixture, 'org-easycla-group-select-live') as HTMLElement;
    }

    it('exists as a polite, atomic region that focus never lands on', async () => {
      getSignOptions.mockReturnValue(of(results([signable])));

      const fixture = await render();

      const region = live(fixture);
      expect(region).not.toBeNull();
      expect(region.getAttribute('aria-live')).toBe('polite');
      expect(region.getAttribute('aria-atomic')).toBe('true');
      // Visually hidden so the sighted viewer keeps the loading spinner, "No matches" panel, and
      // row count as their signal — the region is only for assistive technology.
      expect(region.className).toContain('sr-only');
    });

    it('announces the search starting, then the row count when it lands', async () => {
      // A pending Subject holds the response open past the debounce, so `loading` stays true
      // for the assertion \u2014 a synchronous `of(...)` would flip through both states in one tick
      // and only the terminal announcement would ever be observable.
      const pending = new Subject<ClaGroupSearchResponse>();
      getSignOptions.mockReturnValue(pending);

      const fixture = await render();
      const form = (fixture.componentInstance as unknown as { searchForm: { controls: { query: { setValue: (v: string) => void } } } }).searchForm;
      form.controls.query.setValue('cascade');
      await vi.advanceTimersByTimeAsync(600);
      fixture.detectChanges();
      expect(live(fixture).textContent?.trim()).toBe('Searching CLA groups.');

      pending.next(results([signable, individualOnly]));
      pending.complete();
      fixture.detectChanges();
      expect(live(fixture).textContent?.trim()).toBe('2 CLA groups match.');
    });

    it('reads a single match with singular grammar', async () => {
      getSignOptions.mockReturnValue(of(results([signable])));

      const fixture = await render();
      await search(fixture);

      expect(live(fixture).textContent?.trim()).toBe('1 CLA group matches.');
    });

    it('names the truncation so a viewer knows more matched than are being read', async () => {
      const many = Array.from({ length: 25 }, (_, index) => ({ ...signable, claGroupId: `cla-${index}`, projectSfid: `sfid-${index}` }));
      getSignOptions.mockReturnValue(of(results(many, true)));

      const fixture = await render();
      await search(fixture);

      expect(live(fixture).textContent?.trim()).toBe('More than 25 CLA groups match. Narrow your search.');
    });

    it('says no matches instead of falling silent on an empty results list', async () => {
      getSignOptions.mockReturnValue(of(results([])));

      const fixture = await render();
      await search(fixture);

      expect(live(fixture).textContent?.trim()).toBe('No matching CLA groups.');
    });

    /**
     * The visible error panel already has `role="alert"`, which assistive technology announces
     * assertively. Repeating the same text in the polite region would have a screen reader read
     * the failure twice \u2014 once from the alert, once from the status \u2014 for one event. The alert
     * owns the failure; the polite region stays silent for it.
     */
    it('leaves the failure announcement to the visible alert panel, so it is not read twice', async () => {
      getSignOptions.mockReturnValue(throwError(() => new Error('gateway')));

      const fixture = await render();
      await search(fixture);

      // The alert exists (and carries the failure text), so the announcement is not being lost.
      const errorPanel = testid(fixture, 'org-easycla-group-select-error');
      expect(errorPanel).not.toBeNull();
      expect(errorPanel?.getAttribute('role')).toBe('alert');
      // But the polite region does not repeat it.
      expect(live(fixture).textContent?.trim()).toBe('');
    });

    // "Keep typing" would fire on every keystroke below the minimum, and the visual copy already
    // says what to do. An empty query is likewise nothing to say. Announcing either would be
    // noise a screen reader stops attending to; the region stays empty for both.
    it('stays silent for the empty and keep-typing states', async () => {
      const fixture = await render();
      expect(live(fixture).textContent?.trim()).toBe('');

      const form = (fixture.componentInstance as unknown as { searchForm: { controls: { query: { setValue: (v: string) => void } } } }).searchForm;
      form.controls.query.setValue('ca');
      await vi.advanceTimersByTimeAsync(600);
      fixture.detectChanges();
      expect(live(fixture).textContent?.trim()).toBe('');
    });
  });
});
