// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, FormGroup } from '@angular/forms';
import { Project } from '@lfx-one/shared/interfaces';
import { ProjectService } from '@services/project.service';
import { of, Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectPickerComponent } from './project-picker.component';

const project = { uid: 'project-uid-1', slug: 'my-foundation', name: 'My Foundation' } as Project;
const otherProject = { uid: 'project-uid-2', slug: 'other-foundation', name: 'Other Foundation' } as Project;

describe('ProjectPickerComponent', () => {
  let fixture: ComponentFixture<ProjectPickerComponent>;
  let searchProjects: ReturnType<typeof vi.fn>;
  let form: FormGroup;

  // Not a production visibility change: `select`/`clear`/`hasSelection`/`selectedName`/
  // `searchForm` stay `protected` (template-only surface) — an `any`-typed accessor skips
  // TypeScript's protected check for tests without widening the component's public contract.
  const instance = (): any => fixture.componentInstance;

  beforeEach(async () => {
    searchProjects = vi.fn().mockReturnValue(of([]));
    form = new FormGroup({ parent_project_uid: new FormControl<string | null>(null) });

    await TestBed.configureTestingModule({
      imports: [ProjectPickerComponent],
      providers: [{ provide: ProjectService, useValue: { searchProjects } }],
    }).compileComponents();

    fixture = TestBed.createComponent(ProjectPickerComponent);
    fixture.componentRef.setInput('form', form);
    fixture.componentRef.setInput('uidControl', 'parent_project_uid');
    fixture.detectChanges();
  });

  it('sets the uid control and shows the selected name once a search result is picked', () => {
    instance().select(project);

    expect(form.get('parent_project_uid')?.value).toBe('project-uid-1');
    expect(instance().hasSelection()).toBe(true);
    expect(instance().selectedName()).toBe('My Foundation');
  });

  it('marks the uid control dirty on select() — ProposeComponent.prefillParentFromQueryParam relies on this to detect a real user pick', () => {
    instance().select(project);

    expect(form.get('parent_project_uid')?.dirty).toBe(true);
  });

  it('clear() resets the uid control and the display, and marks it dirty too', () => {
    instance().select(project);

    instance().clear();

    expect(form.get('parent_project_uid')?.value).toBeNull();
    expect(form.get('parent_project_uid')?.dirty).toBe(true);
    expect(instance().hasSelection()).toBe(false);
    expect(instance().selectedName()).toBeNull();
  });

  it('reflects a parent-resolved initialSelection (the async ?parent= prefill case) even though the uid was already set externally', () => {
    form.get('parent_project_uid')?.setValue(project.uid, { emitEvent: false });

    fixture.componentRef.setInput('initialSelection', project);
    fixture.detectChanges();

    expect(instance().hasSelection()).toBe(true);
    expect(instance().selectedName()).toBe('My Foundation');
  });

  it('does not let a slow-resolving initialSelection overwrite a selection the user already made by hand', () => {
    instance().select(otherProject);

    fixture.componentRef.setInput('initialSelection', project);
    fixture.detectChanges();

    expect(form.get('parent_project_uid')?.value).toBe('project-uid-2');
    expect(instance().selectedName()).toBe('Other Foundation');
  });

  it('does not query until the search term reaches 2 characters, then does', async () => {
    vi.useFakeTimers();
    try {
      // Construct under fake timers so `initResults`'s own `startWith('')` debounce timer (fired
      // at construction, from the `beforeEach` fixture) doesn't leave a stray real-clock timer
      // racing the fake-clock assertions below.
      fixture = TestBed.createComponent(ProjectPickerComponent);
      fixture.componentRef.setInput('form', form);
      fixture.componentRef.setInput('uidControl', 'parent_project_uid');
      fixture.detectChanges();

      instance().searchForm.controls.query.setValue('a');
      await vi.advanceTimersByTimeAsync(300);
      expect(searchProjects).not.toHaveBeenCalled();

      instance().searchForm.controls.query.setValue('ac');
      await vi.advanceTimersByTimeAsync(300);
      expect(searchProjects).toHaveBeenCalledWith('ac');
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports an empty result set, then stays usable for a search that finds a match', async () => {
    vi.useFakeTimers();
    try {
      fixture = TestBed.createComponent(ProjectPickerComponent);
      fixture.componentRef.setInput('form', form);
      fixture.componentRef.setInput('uidControl', 'parent_project_uid');
      fixture.detectChanges();

      searchProjects.mockReturnValueOnce(of([]));
      instance().searchForm.controls.query.setValue('ab');
      await vi.advanceTimersByTimeAsync(300);
      expect(searchProjects).toHaveBeenCalledWith('ab');
      expect(instance().results()).toEqual([]);

      searchProjects.mockReturnValueOnce(of([project]));
      instance().searchForm.controls.query.setValue('my');
      await vi.advanceTimersByTimeAsync(300);
      expect(instance().results()).toEqual([project]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not swallow Enter on a rendered search-result option — the submit-guard on the search input must not bubble-cancel a result button's own activation", async () => {
    vi.useFakeTimers();
    try {
      fixture = TestBed.createComponent(ProjectPickerComponent);
      fixture.componentRef.setInput('form', form);
      fixture.componentRef.setInput('uidControl', 'parent_project_uid');
      fixture.detectChanges();

      searchProjects.mockReturnValueOnce(of([project]));
      instance().searchForm.controls.query.setValue('my');
      await vi.advanceTimersByTimeAsync(300);
      // detectChanges(), not whenStable(): every test in this file flushes this way under
      // vi.useFakeTimers() — whenStable() can stall waiting on a scheduler tick that fake timers
      // never fire. Consistent with the rest of the file, not the file's own general convention.
      fixture.detectChanges();

      const option: HTMLElement | null = fixture.nativeElement.querySelector(`[data-testid="propose-project-picker-option-${project.slug}"]`);
      expect(option).not.toBeNull();
      const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
      option!.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('is "searching" while the HTTP round trip is in flight, so the empty state does not flash before real results arrive', async () => {
    vi.useFakeTimers();
    try {
      fixture = TestBed.createComponent(ProjectPickerComponent);
      fixture.componentRef.setInput('form', form);
      fixture.componentRef.setInput('uidControl', 'parent_project_uid');
      fixture.detectChanges();

      const search$ = new Subject<Project[]>();
      searchProjects.mockReturnValueOnce(search$);
      instance().searchForm.controls.query.setValue('ab');

      // Asserted BEFORE advancing the fake clock at all — proves `searching` flips synchronously
      // on the raw keystroke, not only after `debounceTime(300)` elapses (the bug this test guards
      // against: the debounce window itself briefly rendering "No matching projects.").
      expect(instance().searching()).toBe(true);

      await vi.advanceTimersByTimeAsync(300);

      expect(instance().searching()).toBe(true);
      expect(instance().results()).toEqual([]); // still the initial value — not yet a confirmed empty result

      search$.next([project]);
      search$.complete();

      expect(instance().searching()).toBe(false);
      expect(instance().results()).toEqual([project]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps "searching" true when a stale earlier search resolves after the user has already typed further', async () => {
    vi.useFakeTimers();
    try {
      fixture = TestBed.createComponent(ProjectPickerComponent);
      fixture.componentRef.setInput('form', form);
      fixture.componentRef.setInput('uidControl', 'parent_project_uid');
      fixture.detectChanges();

      const staleSearch$ = new Subject<Project[]>();
      searchProjects.mockReturnValueOnce(staleSearch$);
      instance().searchForm.controls.query.setValue('ab');
      await vi.advanceTimersByTimeAsync(300); // 'ab' debounces and issues its (still-pending) search

      const freshSearch$ = new Subject<Project[]>();
      searchProjects.mockReturnValueOnce(freshSearch$);
      instance().searchForm.controls.query.setValue('abc'); // user keeps typing before 'ab' resolves

      // The stale 'ab' request resolves while 'abc' is still inside its own debounce window — it
      // must not clear `searching`, or the empty state would flash for a query the user has left.
      staleSearch$.next([]);
      staleSearch$.complete();
      expect(instance().searching()).toBe(true);

      await vi.advanceTimersByTimeAsync(300); // 'abc' debounces; switchMap cancels nothing new here
      freshSearch$.next([project]);
      freshSearch$.complete();

      expect(instance().searching()).toBe(false);
      expect(instance().results()).toEqual([project]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders the "not sure" hint and no results dropdown before any query', () => {
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="propose-project-picker-results"]')).toBeNull();
    expect(el.textContent).toContain('Not sure?');
  });
});
