// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, CUSTOM_ELEMENTS_SCHEMA, input, output } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { By } from '@angular/platform-browser';
import {
  createEmptyMentorshipEnrollForm,
  MENTORSHIP_ENROLL_DESCRIPTION_MAX,
  MENTORSHIP_LF_PROJECT_PAGE_SIZE,
  MENTORSHIP_RICH_TEXT_RAW_MAX,
} from '@lfx-one/shared/constants';
import { MentorshipAdminService } from '@services/mentorship-admin.service';
import { MentorshipService } from '@services/mentorship.service';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EnrollDetailsStepComponent } from './enroll-details-step.component';

/** Inert stand-in for `lfx-select` that accepts its inputs, so bindings such as `scrollHeight` are not set on a native element. */
@Component({ selector: 'lfx-select', template: '' })
class StubSelectComponent {
  public readonly form = input<unknown>();
  public readonly control = input<unknown>();
  public readonly dataTest = input<unknown>();
  public readonly emptyFilterMessage = input<unknown>();
  public readonly emptyMessage = input<unknown>();
  public readonly filter = input<unknown>();
  public readonly inputId = input<unknown>();
  public readonly lazy = input<unknown>();
  public readonly loading = input<unknown>();
  public readonly optionLabel = input<unknown>();
  public readonly optionValue = input<unknown>();
  public readonly options = input<unknown>();
  public readonly overlayOptions = input<unknown>();
  public readonly placeholder = input<unknown>();
  public readonly resetFilterOnHide = input<unknown>();
  public readonly scrollHeight = input<unknown>();
  public readonly styleClass = input<unknown>();
  public readonly virtualScroll = input<unknown>();
  public readonly virtualScrollItemSize = input<unknown>();
  public readonly virtualScrollOptions = input<unknown>();
  public readonly onChange = output<unknown>();
  public readonly onFilter = output<unknown>();
  public readonly onLazyLoad = output<unknown>();
}

describe('EnrollDetailsStepComponent — description counter', () => {
  let fixture: ComponentFixture<EnrollDetailsStepComponent>;
  let form: FormGroup;

  const counterText = (): string =>
    ((fixture.nativeElement as HTMLElement).querySelector('[data-testid="mentorship-enroll-description-counter"]')?.textContent ?? '').trim();

  const setDescription = (html: string): void => {
    form.controls['description'].setValue(html);
    fixture.detectChanges();
  };

  beforeEach(async () => {
    // The lfx-* wrappers (Tiptap editor, PrimeNG selects) are not under test here — render them as
    // inert custom elements so only this component's own counter logic runs.
    TestBed.overrideComponent(EnrollDetailsStepComponent, { set: { imports: [ReactiveFormsModule, StubSelectComponent], schemas: [CUSTOM_ELEMENTS_SCHEMA] } });

    await TestBed.configureTestingModule({
      imports: [EnrollDetailsStepComponent],
      providers: [
        { provide: MentorshipAdminService, useValue: { getPrograms: () => of({ data: [] }) } },
        {
          provide: MentorshipService,
          useValue: {
            getLfProjects: () => of({ data: [], nextPageToken: null }),
            getCiiBadge: () => of(null),
            isProgramNameAvailable: () => of({ available: true }),
          },
        },
      ],
    }).compileComponents();

    const defaults = createEmptyMentorshipEnrollForm() as unknown as Record<string, unknown>;
    form = new FormGroup(Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, new FormControl(value)])));

    fixture = TestBed.createComponent(EnrollDetailsStepComponent);
    fixture.componentRef.setInput('form', form);
    fixture.detectChanges();
  });

  it('shows the plain-text count for rich text at the raw cap', () => {
    const atCap = `<p>${'a'.repeat(MENTORSHIP_RICH_TEXT_RAW_MAX - 7)}</p>`;
    expect(atCap.length).toBe(MENTORSHIP_RICH_TEXT_RAW_MAX);

    setDescription(atCap);

    expect(counterText()).toBe(`${MENTORSHIP_RICH_TEXT_RAW_MAX - 7} / ${MENTORSHIP_ENROLL_DESCRIPTION_MAX}`);
  });

  it('shows "Over limit" instead of a raw HTML length once the raw cap is exceeded', () => {
    setDescription(`<p>${'<strong>a</strong>'.repeat(Math.ceil(MENTORSHIP_RICH_TEXT_RAW_MAX / 18) + 1)}</p>`);

    expect(counterText()).toBe(`Over limit / ${MENTORSHIP_ENROLL_DESCRIPTION_MAX}`);
  });
});

describe('EnrollDetailsStepComponent — selected project', () => {
  const alpha = { id: 'uid-alpha', name: 'Alpha', slug: 'alpha', logoUrl: 'https://cdn.example/alpha.png' };
  let fixture: ComponentFixture<EnrollDetailsStepComponent>;
  let form: FormGroup;

  beforeEach(async () => {
    TestBed.overrideComponent(EnrollDetailsStepComponent, { set: { imports: [ReactiveFormsModule, StubSelectComponent], schemas: [CUSTOM_ELEMENTS_SCHEMA] } });

    await TestBed.configureTestingModule({
      imports: [EnrollDetailsStepComponent],
      providers: [
        { provide: MentorshipAdminService, useValue: { getPrograms: () => of({ data: [] }) } },
        {
          provide: MentorshipService,
          useValue: {
            getLfProjects: () => of({ data: [alpha], nextPageToken: null }),
            getCiiBadge: () => of(null),
            isProgramNameAvailable: () => of({ available: true }),
          },
        },
      ],
    }).compileComponents();

    const defaults = createEmptyMentorshipEnrollForm() as unknown as Record<string, unknown>;
    form = new FormGroup(Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, new FormControl(value)])));

    fixture = TestBed.createComponent(EnrollDetailsStepComponent);
    fixture.componentRef.setInput('form', form);
    fixture.detectChanges();
  });

  it('keeps the loaded project object, slug included, when its id is selected', async () => {
    form.controls['projectId'].setValue(alpha.id);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.componentInstance.project()).toEqual(alpha);
  });

  it('clears the project when the selection is cleared', async () => {
    form.controls['projectId'].setValue(alpha.id);
    fixture.detectChanges();
    await fixture.whenStable();

    form.controls['projectId'].setValue('');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.componentInstance.project()).toBeNull();
  });
});

describe('EnrollDetailsStepComponent — project lazy loading', () => {
  const lfProject = (key: string) => ({ id: `uid-${key}`, name: key, slug: key });
  const fullPage = Array.from({ length: MENTORSHIP_LF_PROJECT_PAGE_SIZE }, (_, index) => lfProject(`p${index}`));
  const beta = lfProject('beta');
  let fixture: ComponentFixture<EnrollDetailsStepComponent>;
  let form: FormGroup;
  let getLfProjects: ReturnType<typeof vi.fn>;

  const projectSelect = (): StubSelectComponent =>
    fixture.debugElement
      .queryAll(By.directive(StubSelectComponent))
      .map((debugEl) => debugEl.componentInstance as StubSelectComponent)
      .find((select) => select.inputId() === 'projectId') as StubSelectComponent;

  const optionIds = (): string[] => (projectSelect().options() as { value: string }[]).map((option) => option.value);

  const setUp = async (
    firstPage: { id: string; name: string; slug: string }[],
    secondPage: { data: { id: string; name: string; slug: string }[]; nextPageToken: string | null } = { data: [beta], nextPageToken: null }
  ): Promise<void> => {
    getLfProjects = vi.fn((params: { pageToken?: string }) => of(params.pageToken === 'page-2' ? secondPage : { data: firstPage, nextPageToken: 'page-2' }));
    TestBed.overrideComponent(EnrollDetailsStepComponent, { set: { imports: [ReactiveFormsModule, StubSelectComponent], schemas: [CUSTOM_ELEMENTS_SCHEMA] } });

    await TestBed.configureTestingModule({
      imports: [EnrollDetailsStepComponent],
      providers: [
        { provide: MentorshipAdminService, useValue: { getPrograms: () => of({ data: [] }) } },
        { provide: MentorshipService, useValue: { getLfProjects, getCiiBadge: () => of(null), isProgramNameAvailable: () => of({ available: true }) } },
      ],
    }).compileComponents();

    const defaults = createEmptyMentorshipEnrollForm() as unknown as Record<string, unknown>;
    form = new FormGroup(Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, new FormControl(value)])));

    fixture = TestBed.createComponent(EnrollDetailsStepComponent);
    fixture.componentRef.setInput('form', form);
    fixture.detectChanges();
  };

  it('loads the next page with the cursor once a full list is scrolled to its end', async () => {
    await setUp(fullPage);
    expect(optionIds()).toHaveLength(MENTORSHIP_LF_PROJECT_PAGE_SIZE);
    expect(getLfProjects).toHaveBeenCalledTimes(1);

    projectSelect().onLazyLoad.emit({ first: 0, last: MENTORSHIP_LF_PROJECT_PAGE_SIZE - 1 });
    fixture.detectChanges();

    expect(getLfProjects).toHaveBeenLastCalledWith(expect.objectContaining({ pageToken: 'page-2' }));
    expect(optionIds()).toEqual([...fullPage.map((project) => project.id), 'uid-beta']);
  });

  it('follows a short page cursor without waiting for a scroll', async () => {
    await setUp([lfProject('alpha')]);

    expect(getLfProjects).toHaveBeenCalledTimes(2);
    expect(optionIds()).toEqual(['uid-alpha', 'uid-beta']);
  });

  it('does not follow a short page whose cursor came back unchanged', async () => {
    await setUp([lfProject('alpha')], { data: [], nextPageToken: 'page-2' });

    expect(getLfProjects).toHaveBeenCalledTimes(2);
    expect(optionIds()).toEqual(['uid-alpha']);
  });

  it('stops requesting once the cursor runs out', async () => {
    await setUp(fullPage);
    projectSelect().onLazyLoad.emit({ first: 0, last: MENTORSHIP_LF_PROJECT_PAGE_SIZE - 1 });
    fixture.detectChanges();
    projectSelect().onLazyLoad.emit({ first: 0, last: MENTORSHIP_LF_PROJECT_PAGE_SIZE });
    fixture.detectChanges();

    expect(getLfProjects).toHaveBeenCalledTimes(2);
  });

  it('clears the project instead of keeping the previous one when the new id is not loaded', async () => {
    await setUp(fullPage);
    form.controls['projectId'].setValue(fullPage[0].id);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.componentInstance.project()).toEqual(fullPage[0]);

    form.controls['projectId'].setValue('uid-not-loaded');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.componentInstance.project()).toBeNull();
  });
});
