// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { environment } from '@environments/environment';
import { buildMentorshipProgramsUrl } from '@lfx-one/shared/utils';
import { beforeEach, describe, expect, it } from 'vitest';

import { ProgramLinkComponent } from './program-link.component';

describe('ProgramLinkComponent', () => {
  const programId = '3f2b8c1e-7a44-4d0e-9b55-0c1d2e3f4a5b';
  let fixture: ComponentFixture<ProgramLinkComponent>;

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;

  const setup = (id: string | undefined): void => {
    fixture = TestBed.createComponent(ProgramLinkComponent);
    fixture.componentRef.setInput('programId', id);
    fixture.componentRef.setInput('programName', 'GridFlow');
    fixture.componentRef.setInput('testId', 'program-link');
    fixture.detectChanges();
  };

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [ProgramLinkComponent] });
  });

  it("links the name to the program's public page in a new tab", () => {
    setup(programId);

    const link = element().querySelector('a');
    expect(link?.textContent?.trim()).toBe('GridFlow');
    expect(link?.getAttribute('href')).toBe(buildMentorshipProgramsUrl(environment.urls.mentorship, programId));
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link?.getAttribute('data-testid')).toBe('program-link');
  });

  it.each([undefined, '', 'prog-1'])('shows the name as plain text for program id %j', (id) => {
    setup(id);

    expect(element().querySelector('a')).toBeNull();
    expect(element().textContent?.trim()).toBe('GridFlow');
  });
});
