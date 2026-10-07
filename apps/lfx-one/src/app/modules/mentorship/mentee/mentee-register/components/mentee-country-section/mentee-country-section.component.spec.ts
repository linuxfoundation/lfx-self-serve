// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, FormGroup } from '@angular/forms';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { SelectComponent } from '@components/select/select.component';
import {
  COUNTRIES,
  MENTORSHIP_MENTEE_COUNTRY_INTRO,
  MENTORSHIP_MENTEE_COUNTRY_LABEL,
  MENTORSHIP_MENTEE_COUNTRY_PLACEHOLDER,
  MENTORSHIP_MENTEE_COUNTRY_REQUIRED_MESSAGE,
  MENTORSHIP_MENTEE_COUNTRY_TITLE,
} from '@lfx-one/shared/constants';
import { beforeEach, describe, expect, it } from 'vitest';

import { MenteeCountrySectionComponent } from './mentee-country-section.component';

describe('MenteeCountrySectionComponent', () => {
  let fixture: ComponentFixture<MenteeCountrySectionComponent>;
  let form: FormGroup<{ country: FormControl<string> }>;

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const errorElement = (): HTMLElement | null => element().querySelector('[data-testid="mentorship-mentee-country-error"]');
  const select = (): SelectComponent => fixture.debugElement.query(By.directive(SelectComponent)).componentInstance as SelectComponent;

  beforeEach(() => {
    form = new FormGroup({ country: new FormControl('', { nonNullable: true }) });

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [MenteeCountrySectionComponent],
      providers: [provideNoopAnimations()],
    });

    fixture = TestBed.createComponent(MenteeCountrySectionComponent);
    fixture.componentRef.setInput('form', form);
    fixture.detectChanges();
  });

  it('renders the title, intro and a required label pointing at the dropdown', () => {
    const section = element().querySelector('[data-testid="mentorship-mentee-country"]');
    const label = element().querySelector('label[for="mentorship-mentee-country"]');

    expect(section?.querySelector('h2')?.textContent?.trim()).toBe(MENTORSHIP_MENTEE_COUNTRY_TITLE);
    expect(section?.textContent).toContain(MENTORSHIP_MENTEE_COUNTRY_INTRO);
    expect(label?.textContent).toContain(MENTORSHIP_MENTEE_COUNTRY_LABEL);
    expect(label?.querySelector('.text-red-500')?.textContent?.trim()).toBe('*');
  });

  it('binds a filterable dropdown of the ISO countries to the form country control', () => {
    expect(select().form()).toBe(form);
    expect(select().control()).toBe('country');
    expect(select().inputId()).toBe('mentorship-mentee-country');
    expect(select().filter()).toBe(true);
    expect(select().placeholder()).toBe(MENTORSHIP_MENTEE_COUNTRY_PLACEHOLDER);
    expect(select().options()).toHaveLength(COUNTRIES.length);
    expect(select().options()).toContainEqual({ label: 'Kenya', value: 'KE' });
  });

  it('keeps the error hidden until the parent passes one, then shows it as an alert', () => {
    expect(errorElement()).toBeNull();

    fixture.componentRef.setInput('error', MENTORSHIP_MENTEE_COUNTRY_REQUIRED_MESSAGE);
    fixture.detectChanges();

    expect(errorElement()?.textContent?.trim()).toBe(MENTORSHIP_MENTEE_COUNTRY_REQUIRED_MESSAGE);
    expect(errorElement()?.getAttribute('role')).toBe('alert');
  });
});
