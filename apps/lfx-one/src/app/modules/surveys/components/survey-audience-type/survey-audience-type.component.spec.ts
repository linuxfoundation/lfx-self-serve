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
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SurveyAudienceTypeComponent } from './survey-audience-type.component';

describe('SurveyAudienceTypeComponent template picker (#5124)', () => {
  let fixture: ComponentFixture<SurveyAudienceTypeComponent>;
  let openMessenger: ReturnType<typeof vi.fn>;

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

  beforeEach(() => {
    openMessenger = vi.fn();
    TestBed.configureTestingModule({
      imports: [SurveyAudienceTypeComponent],
      providers: [provideNoopAnimations(), { provide: MessageService, useValue: { add: vi.fn() } }, { provide: IntercomService, useValue: { openMessenger } }],
    });
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
