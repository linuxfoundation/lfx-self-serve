// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, FormGroup } from '@angular/forms';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { AutoComplete } from 'primeng/autocomplete';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { AutocompleteComponent } from './autocomplete.component';

describe('AutocompleteComponent', () => {
  let fixture: ComponentFixture<AutocompleteComponent>;

  // jsdom doesn't implement matchMedia; PrimeNG's Overlay (rendered under p-autoComplete once the
  // panel opens) calls it to decide modal/non-modal mode.
  beforeAll(() => {
    window.matchMedia ??= ((query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }) as unknown as MediaQueryList) as typeof window.matchMedia;
  });

  afterEach(() => {
    fixture?.destroy();
  });

  const render = async (form: FormGroup): Promise<void> => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [AutocompleteComponent],
      providers: [provideNoopAnimations()],
    }).compileComponents();

    fixture = TestBed.createComponent(AutocompleteComponent);
    fixture.componentRef.setInput('form', form);
    fixture.componentRef.setInput('control', 'org');
    fixture.componentRef.setInput('suggestions', ['Alliander']);
    await fixture.whenStable();
  };

  const queryAutoComplete = (): AutoComplete => fixture.debugElement.query(By.directive(AutoComplete)).componentInstance as AutoComplete;

  // #384 (Issue 1): PrimeNG commits a keyboard selection (Enter/Tab) by indexing into the live
  // `suggestions` array at `focusedOptionIndex`, not by the row the user actually arrow-keyed onto.
  // A row focused before a debounced search response replaces `suggestions` must lose that focus —
  // otherwise Enter can commit a different option than the one highlighted.
  it('resets the focused option index when suggestions change while the panel is open', async () => {
    const form = new FormGroup({ org: new FormControl<string | null>(null) });
    await render(form);

    const autoComplete = queryAutoComplete();
    autoComplete.overlayVisible = true;
    autoComplete.focusedOptionIndex.set(0);

    fixture.componentRef.setInput('suggestions', ['Alliander Tippiq']);
    await fixture.whenStable();

    expect(autoComplete.focusedOptionIndex()).toBe(-1);
  });

  it('leaves the focused option index alone when the panel is closed', async () => {
    const form = new FormGroup({ org: new FormControl<string | null>(null) });
    await render(form);

    const autoComplete = queryAutoComplete();
    autoComplete.overlayVisible = false;
    autoComplete.focusedOptionIndex.set(0);

    fixture.componentRef.setInput('suggestions', ['Alliander Tippiq']);
    await fixture.whenStable();

    expect(autoComplete.focusedOptionIndex()).toBe(0);
  });

  it('still commits a mouse-click selection after suggestions change', async () => {
    const form = new FormGroup({ org: new FormControl<string | null>(null) });
    await render(form);

    const autoComplete = queryAutoComplete();
    autoComplete.overlayVisible = true;
    autoComplete.focusedOptionIndex.set(0);

    fixture.componentRef.setInput('suggestions', ['Alliander Tippiq', 'Alliander']);
    await fixture.whenStable();

    autoComplete.onOptionSelect(new MouseEvent('click'), 'Alliander');

    expect(form.get('org')?.value).toBe('Alliander');
  });

  // copilot (PR #3462): a blanket -1 would undo PrimeNG's own autoOptionFocus behavior — when that
  // input is on, a suggestions change should focus the first valid option, not clear focus.
  it('focuses the first valid option instead of -1 when autoOptionFocus is enabled', async () => {
    const form = new FormGroup({ org: new FormControl<string | null>(null) });
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [AutocompleteComponent],
      providers: [provideNoopAnimations()],
    }).compileComponents();

    fixture = TestBed.createComponent(AutocompleteComponent);
    fixture.componentRef.setInput('form', form);
    fixture.componentRef.setInput('control', 'org');
    fixture.componentRef.setInput('suggestions', ['Alliander']);
    fixture.componentRef.setInput('autoOptionFocus', true);
    await fixture.whenStable();

    const autoComplete = queryAutoComplete();
    autoComplete.overlayVisible = true;
    autoComplete.focusedOptionIndex.set(5);

    fixture.componentRef.setInput('suggestions', ['Alliander Tippiq']);
    await fixture.whenStable();

    expect(autoComplete.focusedOptionIndex()).toBe(0);
  });
});
