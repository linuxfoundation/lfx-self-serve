// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, CUSTOM_ELEMENTS_SCHEMA, input, output } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { By } from '@angular/platform-browser';
import { FilterService } from 'primeng/api';
import {
  createEmptyMentorshipEnrollForm,
  MENTORSHIP_ENROLL_DESCRIPTION_MAX,
  MENTORSHIP_ENROLL_LOGO_MAX_BYTES,
  MENTORSHIP_ENROLL_PROJECTS_EMPTY_MESSAGE,
  MENTORSHIP_ENROLL_PROJECTS_SEARCHING_MESSAGE,
  MENTORSHIP_LF_PROJECT_MAX_AUTO_FOLLOWS,
  MENTORSHIP_LF_PROJECT_PAGE_SIZE,
  MENTORSHIP_LF_PROJECT_REMOTE_FILTER_FIELD,
  MENTORSHIP_RICH_TEXT_RAW_MAX,
} from '@lfx-one/shared/constants';
import { MentorshipAdminService } from '@services/mentorship-admin.service';
import { MentorshipService } from '@services/mentorship.service';
import { Observable, of, throwError } from 'rxjs';
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
  public readonly filterBy = input<unknown>();
  public readonly filterMatchMode = input<unknown>();
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
            getLfProjects: () => of({ data: [] }),
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
            getLfProjects: () => of({ data: [alpha] }),
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

  const failedAlert = (): HTMLElement | null => (fixture.nativeElement as HTMLElement).querySelector('[data-testid="mentorship-enroll-project-failed"]');
  const clickRetry = (): void => {
    (fixture.nativeElement as HTMLElement).querySelector('[data-testid="mentorship-enroll-project-retry"]')?.dispatchEvent(new CustomEvent('onClick'));
    fixture.detectChanges();
  };
  const scrollToEnd = (): void => {
    projectSelect().onLazyLoad.emit({ first: 0, last: optionIds().length - 1 });
    fixture.detectChanges();
  };

  const setUp = async (
    firstPage: { id: string; name: string; slug: string }[],
    secondPage: { data: { id: string; name: string; slug: string }[]; page_token?: string } = { data: [beta] },
    respond?: (params: { pageToken?: string; search?: string }) => Observable<unknown> | undefined
  ): Promise<void> => {
    getLfProjects = vi.fn(
      (params: { pageToken?: string; search?: string }) =>
        respond?.(params) ?? of(params.pageToken === 'page-2' ? secondPage : { data: firstPage, page_token: 'page-2' })
    );
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

  it('leaves the list to the server: the select filters on a field no option has, so an alias match is not hidden', async () => {
    await setUp([lfProject('alpha')]);

    expect(projectSelect().filterBy()).toBe(MENTORSHIP_LF_PROJECT_REMOTE_FILTER_FIELD);
    expect(projectSelect().filterMatchMode()).toBe('notEquals');
    // The select hands these to PrimeNG's filter service, which must keep every option whatever the box holds.
    const options = projectSelect().options() as { value: string }[];
    expect(new FilterService().filter(options, [MENTORSHIP_LF_PROJECT_REMOTE_FILTER_FIELD], 'a typed alias', 'notEquals')).toEqual(options);
  });

  it('says it is searching from the keystroke through the debounce, not "no results"', async () => {
    await setUp([], { data: [] }, (params) => (params.search === 'zzz' ? of({ data: [] }) : undefined));
    vi.useFakeTimers();
    try {
      projectSelect().onFilter.emit({ filter: 'zzz' });
      fixture.detectChanges();
      expect(projectSelect().emptyMessage()).toBe(MENTORSHIP_ENROLL_PROJECTS_SEARCHING_MESSAGE);
      expect(getLfProjects).not.toHaveBeenCalledWith(expect.objectContaining({ search: 'zzz' }));

      vi.advanceTimersByTime(300);
      fixture.detectChanges();
      expect(getLfProjects).toHaveBeenCalledWith(expect.objectContaining({ search: 'zzz' }));
      expect(projectSelect().emptyMessage()).toBe(MENTORSHIP_ENROLL_PROJECTS_EMPTY_MESSAGE);
    } finally {
      vi.useRealTimers();
    }
  });

  it('follows a short page cursor without waiting for a scroll', async () => {
    await setUp([lfProject('alpha')]);

    expect(getLfProjects).toHaveBeenCalledTimes(2);
    expect(optionIds()).toEqual(['uid-alpha', 'uid-beta']);
  });

  it('stops following short pages by itself once it has followed the cap', async () => {
    let reads = 0;
    await setUp([], undefined, () => {
      reads++;
      return of({ data: [lfProject(`short-${reads}`)], page_token: `cursor-${reads}` });
    });

    expect(getLfProjects).toHaveBeenCalledTimes(1 + MENTORSHIP_LF_PROJECT_MAX_AUTO_FOLLOWS);
    expect(optionIds()).toHaveLength(1 + MENTORSHIP_LF_PROJECT_MAX_AUTO_FOLLOWS);
  });

  it('leaves a short page to the scroller once a page worth of projects is loaded', async () => {
    const rest = fullPage.slice(1);
    await setUp([lfProject('alpha')], { data: rest, page_token: 'page-3' });

    expect(getLfProjects).toHaveBeenCalledTimes(2);
    expect(optionIds()).toHaveLength(MENTORSHIP_LF_PROJECT_PAGE_SIZE);
  });

  it('treats a cursor that came back unchanged as the end, neither following it nor loading it on scroll', async () => {
    await setUp([lfProject('alpha')], { data: [], page_token: 'page-2' });

    expect(getLfProjects).toHaveBeenCalledTimes(2);
    expect(optionIds()).toEqual(['uid-alpha']);

    scrollToEnd();

    expect(getLfProjects).toHaveBeenCalledTimes(2);
  });

  it('shows a failed first page with Try again instead of an empty list, and rereads it on retry', async () => {
    let failFirst = true;
    await setUp(fullPage, undefined, (params) => {
      if (params.pageToken || !failFirst) return undefined;
      failFirst = false;
      return throwError(() => new Error('upstream down'));
    });
    expect(failedAlert()).not.toBeNull();
    expect(optionIds()).toEqual([]);

    clickRetry();

    expect(getLfProjects).toHaveBeenCalledTimes(2);
    expect(getLfProjects).toHaveBeenLastCalledWith(expect.not.objectContaining({ pageToken: expect.anything() }));
    expect(failedAlert()).toBeNull();
    expect(optionIds()).toHaveLength(MENTORSHIP_LF_PROJECT_PAGE_SIZE);
  });

  it('keeps the loaded list and the cursor when a later page fails, and retries that page', async () => {
    let failNext = true;
    await setUp(fullPage, undefined, (params) => {
      if (params.pageToken !== 'page-2' || !failNext) return undefined;
      failNext = false;
      return throwError(() => new Error('upstream down'));
    });

    scrollToEnd();
    expect(failedAlert()).not.toBeNull();
    expect(optionIds()).toHaveLength(MENTORSHIP_LF_PROJECT_PAGE_SIZE);

    scrollToEnd();
    expect(getLfProjects).toHaveBeenCalledTimes(2);

    clickRetry();

    expect(getLfProjects).toHaveBeenCalledTimes(3);
    expect(getLfProjects).toHaveBeenLastCalledWith(expect.objectContaining({ pageToken: 'page-2' }));
    expect(failedAlert()).toBeNull();
    expect(optionIds()).toEqual([...fullPage.map((project) => project.id), 'uid-beta']);
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

describe('EnrollDetailsStepComponent — logo file', () => {
  let fixture: ComponentFixture<EnrollDetailsStepComponent>;
  let form: FormGroup;

  const pickLogo = (file: File | null): void => {
    const input = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    Object.defineProperty(input, 'files', { value: file ? [file] : [], configurable: true });
    input!.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  };

  beforeEach(async () => {
    TestBed.overrideComponent(EnrollDetailsStepComponent, { set: { imports: [ReactiveFormsModule, StubSelectComponent], schemas: [CUSTOM_ELEMENTS_SCHEMA] } });

    await TestBed.configureTestingModule({
      imports: [EnrollDetailsStepComponent],
      providers: [
        { provide: MentorshipAdminService, useValue: { getPrograms: () => of({ data: [] }) } },
        {
          provide: MentorshipService,
          useValue: {
            getLfProjects: () => of({ data: [] }),
            getCiiBadge: () => of(null),
            isProgramNameAvailable: () => of({ available: true }),
          },
        },
      ],
    }).compileComponents();

    const defaults = createEmptyMentorshipEnrollForm() as unknown as Record<string, unknown>;
    form = new FormGroup(Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, new FormControl(value)])));

    URL.createObjectURL = vi.fn(() => 'blob:http://localhost/preview');
    URL.revokeObjectURL = vi.fn();

    fixture = TestBed.createComponent(EnrollDetailsStepComponent);
    fixture.componentRef.setInput('form', form);
    fixture.detectChanges();
  });

  it('exposes a valid picked file through the logoFile model', () => {
    const file = new File(['png'], 'logo.png', { type: 'image/png' });

    pickLogo(file);

    expect(fixture.componentInstance.logoFile()).toBe(file);
    expect(form.controls['logoFileName'].value).toBe('logo.png');
  });

  it('refuses a file of the wrong type and keeps the model empty', () => {
    pickLogo(new File(['gif'], 'logo.gif', { type: 'image/gif' }));

    expect(fixture.componentInstance.logoFile()).toBeNull();
    expect(form.controls['logoFileName'].value).toBe('');
  });

  it('refuses a file over the size cap', () => {
    const big = new File(['x'], 'logo.png', { type: 'image/png' });
    Object.defineProperty(big, 'size', { value: MENTORSHIP_ENROLL_LOGO_MAX_BYTES + 1 });

    pickLogo(big);

    expect(fixture.componentInstance.logoFile()).toBeNull();
  });

  it('clears the model when the picker is emptied', () => {
    pickLogo(new File(['png'], 'logo.png', { type: 'image/png' }));

    pickLogo(null);

    expect(fixture.componentInstance.logoFile()).toBeNull();
  });
});
