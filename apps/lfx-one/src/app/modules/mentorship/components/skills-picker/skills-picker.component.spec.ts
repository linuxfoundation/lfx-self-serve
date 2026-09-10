// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, FormGroup } from '@angular/forms';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MENTORSHIP_SKILL_OPTIONS } from '@lfx-one/shared/constants';
import { beforeEach, describe, expect, it } from 'vitest';

import { SkillsPickerComponent } from './skills-picker.component';

describe('SkillsPickerComponent', () => {
  let fixture: ComponentFixture<SkillsPickerComponent>;
  let form: FormGroup<{ skills: FormControl<string[]> }>;

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const chipLabels = (): string[] =>
    Array.from(element().querySelectorAll('[data-testid="picker-skill-list"] span')).map((el) => (el.textContent ?? '').trim());

  const pick = (skill: string): void => {
    fixture.componentInstance['draftForm'].controls.skill.setValue(skill);
    fixture.componentInstance['addSkill']();
    fixture.detectChanges();
  };

  beforeEach(() => {
    form = new FormGroup({ skills: new FormControl<string[]>([], { nonNullable: true }) });

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [SkillsPickerComponent],
      providers: [provideNoopAnimations()],
    });

    fixture = TestBed.createComponent(SkillsPickerComponent);
    fixture.componentRef.setInput('form', form);
    fixture.componentRef.setInput('label', 'Which of your skills should we feature?');
    fixture.componentRef.setInput('idPrefix', 'picker');
    fixture.detectChanges();
  });

  it('writes chosen skills to the caller form and renders them as chips', () => {
    pick('Go');
    pick('Kubernetes');

    expect(form.controls.skills.value).toEqual(['Go', 'Kubernetes']);
    expect(chipLabels()).toEqual(['Go', 'Kubernetes']);
  });

  it('ignores a repeat of a skill already chosen, whatever its casing', () => {
    pick('Go');
    pick('go');
    pick('GO');

    expect(form.controls.skills.value).toEqual(['Go']);
  });

  it('drops chosen skills from the options so they cannot be picked twice', () => {
    const before = fixture.componentInstance['availableSkills']().length;
    pick(MENTORSHIP_SKILL_OPTIONS[0]);

    const after = fixture.componentInstance['availableSkills']();
    expect(after.length).toBe(before - 1);
    expect(after.map((option) => option.value)).not.toContain(MENTORSHIP_SKILL_OPTIONS[0]);
  });

  it('clears the draft select after adding, so the added skill does not look selected', () => {
    pick('Go');

    expect(fixture.componentInstance['draftForm'].controls.skill.value).toBe('');
  });

  it('removes a skill from the caller form', () => {
    pick('Go');
    pick('Kubernetes');

    fixture.componentInstance['removeSkill']('Go');
    fixture.detectChanges();

    expect(form.controls.skills.value).toEqual(['Kubernetes']);
    expect(chipLabels()).toEqual(['Kubernetes']);
  });

  it('repaints when the caller writes the skills itself', () => {
    // The enroll wizard prefills skills from an imported program.
    form.controls.skills.setValue(['Rust']);
    fixture.detectChanges();

    expect(chipLabels()).toEqual(['Rust']);
  });

  it('shows the error the caller passes down', () => {
    expect(element().querySelector('[data-testid="picker-skill-error"]')).toBeNull();

    fixture.componentRef.setInput('error', 'Add at least one skill.');
    fixture.detectChanges();

    expect(element().querySelector('[data-testid="picker-skill-error"]')?.textContent?.trim()).toBe('Add at least one skill.');
  });
});
