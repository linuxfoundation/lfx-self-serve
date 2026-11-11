// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal, TransferState } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, FormGroup } from '@angular/forms';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { DEFAULT_RUNTIME_CONFIG, RUNTIME_CONFIG_KEY } from '@app/shared/providers/runtime-config.provider';
import { SelectComponent } from '@components/select/select.component';
import { Committee, SurveyTemplatesState } from '@lfx-one/shared/interfaces';
import { IntercomService } from '@services/intercom.service';
import { MessageService } from 'primeng/api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SurveyAudienceTypeComponent } from './survey-audience-type.component';

describe('SurveyAudienceTypeComponent template picker (#5124)', () => {
  let fixture: ComponentFixture<SurveyAudienceTypeComponent>;
  let openMessenger: ReturnType<typeof vi.fn>;
  let scrollIntoView: typeof HTMLElement.prototype.scrollIntoView;

  const byTestId = (id: string): HTMLElement | null => (fixture.nativeElement as HTMLElement).querySelector(`[data-testid="${id}"]`);

  const render = async (templatesState: SurveyTemplatesState): Promise<void> => {
    const form = new FormGroup({ committees: new FormControl([]), surveyTemplate: new FormControl('') });
    fixture = TestBed.createComponent(SurveyAudienceTypeComponent);
    fixture.componentRef.setInput('form', form);
    fixture.componentRef.setInput('formValue', signal(form.getRawValue()));
    // A locked group context keeps the committee checkbox list (and its services) out of the render.
    fixture.componentRef.setInput('committeeContext', { uid: 'c-1', name: 'Board', category: 'Board' } as Committee);
    fixture.componentRef.setInput('templatesState', templatesState);
    fixture.detectChanges();
    await fixture.whenStable();
  };

  afterEach(async () => {
    // Let PrimeNG's zero-delay overlay alignment finish before restoring browser shims.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    fixture.destroy();
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    openMessenger = vi.fn();
    // JSDOM lacks the browser APIs used by PrimeNG's real select overlays.
    scrollIntoView = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = vi.fn();
    vi.stubGlobal('matchMedia', (media: string) => ({
      matches: false,
      media,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: () => false,
    }));
    TestBed.configureTestingModule({
      imports: [SurveyAudienceTypeComponent],
      providers: [provideNoopAnimations(), { provide: MessageService, useValue: { add: vi.fn() } }, { provide: IntercomService, useValue: { openMessenger } }],
    });
  });

  it('explains the template source and labels the searchable picker', async () => {
    await render({ status: 'ready', options: [{ label: 'Board NPS Survey', value: '1' }] });

    expect(byTestId('survey-template-heading')?.textContent).toContain('NPS Survey Templates');
    expect(byTestId('survey-template-heading')?.querySelector('span')?.getAttribute('aria-hidden')).toBe('true');
    expect(byTestId('survey-template-guidance')?.textContent?.trim()).toBe(
      'Templates come from the SurveyMonkey survey workgroup. Select one to use its questions in your survey.'
    );

    const select = fixture.debugElement.query(By.directive(SelectComponent)).componentInstance as SelectComponent;
    expect(select.filter()).toBe(true);
    expect(select.filterBy()).toBe('label');
    expect(select.filterPlaceholder()).toBe('Search templates...');
    expect(select.ariaLabelledBy()).toBe('survey-template-heading');
    expect(select.ariaFilterLabel()).toBe('Search survey templates');
    expect(select.resetFilterOnHide()).toBe(true);
  });

  it('filters titles case-insensitively and selects the real template ID', async () => {
    await render({
      status: 'ready',
      options: [
        { label: 'Board NPS Survey', value: 'board-template' },
        { label: 'Maintainer NPS Survey', value: 'maintainer-template' },
      ],
    });

    (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('[role="combobox"]')?.click();
    await fixture.whenStable();
    const search = document.querySelector<HTMLInputElement>('input[aria-label="Search survey templates"]');
    expect(search).not.toBeNull();
    search!.value = 'mAiNtAiNeR';
    search!.dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.whenStable();

    const options = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'));
    expect(options).toHaveLength(1);
    expect(options[0].textContent).toContain('Maintainer NPS Survey');
    options[0].click();
    await fixture.whenStable();

    expect(fixture.componentInstance.form().get('surveyTemplate')?.value).toBe('maintainer-template');
    (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('[role="combobox"]')?.click();
    await fixture.whenStable();
    expect(document.querySelector<HTMLInputElement>('input[aria-label="Search survey templates"]')?.value).toBe('');
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(2);
  });

  it('distinguishes a search with no matches from an empty template inventory', async () => {
    await render({ status: 'ready', options: [{ label: 'Board NPS Survey', value: '1' }] });
    (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('[role="combobox"]')?.click();
    await fixture.whenStable();
    const search = document.querySelector<HTMLInputElement>('input[aria-label="Search survey templates"]');
    expect(search).not.toBeNull();
    search!.value = 'no-such-template';
    search!.dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.whenStable();

    // PrimeNG renders its no-match message as a non-selectable option row.
    const rows = Array.from(document.querySelectorAll('[role="option"]'));
    expect(rows.map((row) => row.textContent?.trim())).toEqual(['No templates match your search.']);
    expect(byTestId('survey-template-empty')).toBeNull();
  });

  it('passes the loading state to lfx-select', async () => {
    await render({ status: 'loading', options: [] });

    const select = fixture.debugElement.query(By.directive(SelectComponent)).componentInstance as SelectComponent;
    expect(select.loading()).toBe(true);
    expect(byTestId('survey-template-error')).toBeNull();
    expect(byTestId('survey-template-empty')).toBeNull();
  });

  it('shows the load error, and Try again emits retryTemplates', async () => {
    await render({ status: 'error', options: [] });
    const retry = vi.fn();
    fixture.componentInstance.retryTemplates.subscribe(retry);

    expect(byTestId('survey-template-error')?.textContent?.trim()).toBe("We couldn't load survey templates.");
    byTestId('survey-template-retry')?.click();

    expect(retry).toHaveBeenCalledOnce();
  });

  it('shows the empty message alongside Contact support when no templates exist', async () => {
    await render({ status: 'ready', options: [] });

    expect(byTestId('survey-template-empty')?.textContent?.trim()).toBe('No survey templates are available yet.');
    expect(byTestId('survey-template-contact-support')).not.toBeNull();
  });

  it('lists the loaded options without the empty or error messages', async () => {
    await render({ status: 'ready', options: [{ label: 'Board Survey', value: '1' }] });

    const select = fixture.debugElement.query(By.directive(SelectComponent)).componentInstance as SelectComponent;
    expect(select.options()).toEqual([{ label: 'Board Survey', value: '1' }]);
    expect(select.loading()).toBe(false);
    expect(byTestId('survey-template-empty')).toBeNull();
    expect(byTestId('survey-template-error')).toBeNull();
  });

  it('opens the Intercom messenger from Contact support', async () => {
    await render({ status: 'ready', options: [] });
    TestBed.inject(TransferState).set(RUNTIME_CONFIG_KEY, { ...DEFAULT_RUNTIME_CONFIG, intercomAppId: 'test-app-id' });
    const button = byTestId('survey-template-contact-support') as HTMLButtonElement | null;

    expect(button?.tagName).toBe('BUTTON');
    expect(button?.getAttribute('type')).toBe('button');
    button?.click();

    expect(openMessenger).toHaveBeenCalledWith('test-app-id', expect.any(Function));
  });
});
