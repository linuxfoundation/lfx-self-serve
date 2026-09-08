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

  beforeEach(() => {
    vi.useFakeTimers();
    getSignOptions.mockReset();
    close.mockClear();
  });

  afterEach(() => vi.useRealTimers());

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

    expect(testid(fixture, 'org-easycla-group-select-no-match')).not.toBeNull();
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
   * The highlight roves from the text box, which keeps focus, so `aria-activedescendant` on the
   * listbox is what tells a screen reader which row is current.
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

    it('names the highlighted row so a screen reader can follow the arrow keys', async () => {
      getSignOptions.mockReturnValue(of(results([signable])));

      const fixture = await render();
      await search(fixture);
      expect(results_(fixture).getAttribute('aria-activedescendant')).toBeNull();

      press(fixture, 'ArrowDown');

      expect(results_(fixture).getAttribute('aria-activedescendant')).toBe(`org-easycla-group-option-${signable.claGroupId}`);
      expect(row(fixture, signable).id).toBe(`org-easycla-group-option-${signable.claGroupId}`);
    });

    it('moves down and back up through the list', async () => {
      getSignOptions.mockReturnValue(of(results([signable, individualOnly])));

      const fixture = await render();
      await search(fixture);
      press(fixture, 'ArrowDown');
      press(fixture, 'ArrowDown');
      expect(results_(fixture).getAttribute('aria-activedescendant')).toBe(`org-easycla-group-option-${individualOnly.claGroupId}`);

      press(fixture, 'ArrowUp');

      expect(results_(fixture).getAttribute('aria-activedescendant')).toBe(`org-easycla-group-option-${signable.claGroupId}`);
    });

    // The highlight does stop on a row that cannot be signed, because the reason it cannot is the
    // row's whole payload and skipping past it would keep that from a keyboard-only viewer
    // entirely. Enter is what refuses.
    it('highlights a CLA group that cannot be signed but will not choose it', async () => {
      getSignOptions.mockReturnValue(of(results([multiProject])));

      const fixture = await render();
      await search(fixture, 'driftwood');
      press(fixture, 'ArrowDown');
      expect(results_(fixture).getAttribute('aria-activedescendant')).toBe(`org-easycla-group-option-${multiProject.claGroupId}`);

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

      expect(results_(fixture).getAttribute('aria-activedescendant')).toBeNull();
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
});
