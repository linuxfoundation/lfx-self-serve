// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FormArray, FormGroup } from '@angular/forms';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NewsletterComposerBlock, NewsletterFieldEntry, NewsletterFieldSchema } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it } from 'vitest';

import { NewsletterBlockFieldsComponent } from './newsletter-block-fields.component';

/**
 * The fields panel builds a reactive form per selected block and re-emits the
 * assembled `content` on every change. These tests pin that class behavior —
 * form building/seeding, the change emit, array add/remove, the rebuild-on-new-
 * block, and the non-default-only spacing persistence. The template + LFX form
 * wrappers are overridden away so only the class logic runs (the Tiptap editor
 * and PrimeNG wrappers are not exercised here).
 */
describe('NewsletterBlockFieldsComponent', () => {
  let fixture: ComponentFixture<NewsletterBlockFieldsComponent>;
  let component: NewsletterBlockFieldsComponent;

  const block = (id: string, content: Record<string, unknown>): NewsletterComposerBlock => ({
    id,
    block_type: 'text',
    label: id,
    isContainer: false,
    content,
  });

  // Protected form signal + spacing keys, read without widening the public API.
  const priv = () =>
    component as unknown as {
      form(): FormGroup | null;
      fieldEntries(): NewsletterFieldEntry[];
      paddingKey: string;
      addItem(e: NewsletterFieldEntry): void;
      removeItem(k: string, i: number): void;
    };
  const setInputs = (schema: NewsletterFieldSchema | null, b: NewsletterComposerBlock | null): void => {
    fixture.componentRef.setInput('schema', schema);
    fixture.componentRef.setInput('block', b);
    fixture.detectChanges();
  };

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [NewsletterBlockFieldsComponent] });
    // Strip the template + heavy child imports so the class effect runs without
    // instantiating the LFX form wrappers.
    TestBed.overrideComponent(NewsletterBlockFieldsComponent, { set: { template: '', imports: [] } });
    fixture = TestBed.createComponent(NewsletterBlockFieldsComponent);
    component = fixture.componentInstance;
  });

  it('builds one control per schema field, seeded from the block content', () => {
    setInputs({ title: { type: 'text', label: 'Title' }, body: { type: 'richtext' } }, block('b1', { title: 'Hello', body: '<p>x</p>' }));

    const form = priv().form();
    expect(form?.get('title')?.value).toBe('Hello');
    expect(form?.get('body')?.value).toBe('<p>x</p>');
    // The universal spacing controls are auto-injected.
    expect(form?.get(priv().paddingKey)).toBeTruthy();
  });

  it('emits the assembled content whenever a field changes', () => {
    setInputs({ title: { type: 'text' } }, block('b1', { title: 'Hello' }));
    let emitted: Record<string, unknown> | undefined;
    component.contentChange.subscribe((c) => (emitted = c));

    priv().form()?.get('title')?.setValue('Changed');
    expect(emitted?.['title']).toBe('Changed');
  });

  it('adds and removes items on an array field', () => {
    setInputs({ jobs: { type: 'array', fields: { role: { type: 'text' } } } }, block('b1', { jobs: [{ role: 'A' }] }));
    const entry = priv()
      .fieldEntries()
      .find((e) => e.key === 'jobs')!;
    const array = () => priv().form()?.get('jobs') as FormArray;

    expect(array().length).toBe(1);
    priv().addItem(entry);
    expect(array().length).toBe(2);
    priv().removeItem('jobs', 0);
    expect(array().length).toBe(1);
  });

  it('rebuilds the form for a newly selected block', () => {
    setInputs({ title: { type: 'text' } }, block('b1', { title: 'One' }));
    expect(priv().form()?.get('title')?.value).toBe('One');

    // A different block with a different field set must swap the controls.
    setInputs({ heading: { type: 'text' } }, block('b2', { heading: 'Two' }));
    expect(priv().form()?.get('title')).toBeNull();
    expect(priv().form()?.get('heading')?.value).toBe('Two');
  });

  it('persists a spacing override only when it is non-default', () => {
    setInputs({ title: { type: 'text' } }, block('b1', { title: 'Hello' }));
    let emitted: Record<string, unknown> | undefined;
    component.contentChange.subscribe((c) => (emitted = c));

    // A non-default padding is carried into content.
    priv().form()?.get(priv().paddingKey)?.setValue('10px');
    expect(emitted?.[priv().paddingKey]).toBe('10px');

    // Back to the default clears it from content (a clean, default-spaced block).
    priv().form()?.get(priv().paddingKey)?.setValue('0px');
    expect(emitted?.[priv().paddingKey]).toBeUndefined();
  });

  it('clears the form when no block is selected', () => {
    setInputs({ title: { type: 'text' } }, block('b1', { title: 'Hello' }));
    expect(priv().form()).not.toBeNull();

    setInputs(null, null);
    expect(priv().form()).toBeNull();
  });
});
