// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, FormGroup } from '@angular/forms';
import { Project } from '@lfx-one/shared/interfaces';
import { ProjectService } from '@services/project.service';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectPickerComponent } from './project-picker.component';

const project = { uid: 'project-uid-1', slug: 'my-foundation', name: 'My Foundation' } as Project;

describe('ProjectPickerComponent', () => {
  let fixture: ComponentFixture<ProjectPickerComponent>;
  let searchProjects: ReturnType<typeof vi.fn>;
  let form: FormGroup;

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
    fixture.componentInstance.select(project);

    expect(form.get('parent_project_uid')?.value).toBe('project-uid-1');
    expect(fixture.componentInstance.hasSelection()).toBe(true);
    expect(fixture.componentInstance.selectedName()).toBe('My Foundation');
  });

  it('clear() resets the uid control and the display', () => {
    fixture.componentInstance.select(project);

    fixture.componentInstance.clear();

    expect(form.get('parent_project_uid')?.value).toBeNull();
    expect(fixture.componentInstance.hasSelection()).toBe(false);
    expect(fixture.componentInstance.selectedName()).toBeNull();
  });

  it('reflects a parent-resolved initialSelection (the async ?parent= prefill case) even though the uid was already set externally', () => {
    form.get('parent_project_uid')?.setValue(project.uid, { emitEvent: false });

    fixture.componentRef.setInput('initialSelection', project);
    fixture.detectChanges();

    expect(fixture.componentInstance.hasSelection()).toBe(true);
    expect(fixture.componentInstance.selectedName()).toBe('My Foundation');
  });

  it('renders the "not sure" hint and no results dropdown for a query under 2 characters', () => {
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="propose-project-picker-results"]')).toBeNull();
    expect(el.textContent).toContain('Not sure?');
  });
});
