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
      trackByFormKey(i: number, e: NewsletterFieldEntry): string;
      fieldRows(): NewsletterFieldEntry[];
      urlErrors(): Record<string, string>;
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

  it('changes the row track key when another block with the same richtext field is selected', () => {
    // lfx-rich-editor binds to its first control only, so the row must remount
    // when the form is rebuilt, or block B would show and then save block A's text.
    const schema: NewsletterFieldSchema = { body: { type: 'richtext' } };
    setInputs(schema, block('b1', { body: '<p>First</p>' }));
    const entry = priv().fieldEntries()[0];
    const firstKey = priv().trackByFormKey(0, entry);

    const firstRows = priv().fieldRows();

    setInputs(schema, block('b2', { body: '<p>Second</p>' }));
    expect(priv().form()?.get('body')?.value).toBe('<p>Second</p>');
    // @for only re-reads its track keys when the collection changes, so the rows
    // must be a new array even though both blocks share one schema.
    expect(priv().fieldRows()).not.toBe(firstRows);
    expect(priv().trackByFormKey(0, priv().fieldEntries()[0])).not.toBe(firstKey);
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

  it('flags a link or image field whose value the newsletter would leave out (#5296)', () => {
    fixture.componentRef.setInput(
      'urlFields',
      new Map([
        ['url', 'href'],
        ['image', 'src'],
        ['items.link', 'href'],
        ['cta', 'href'],
      ])
    );
    setInputs(
      {
        url: { type: 'text' },
        image: { type: 'image' },
        cta: { type: 'text' },
        link: { type: 'text' },
        items: { type: 'array', fields: { link: { type: 'text' } } },
      },
      block('b1', {
        url: 'javascript:alert(1)',
        image: 'https://example.com/a.png',
        // An empty link field is fine, and a plain text field named like an item's link isn't a link.
        cta: '',
        link: 'see below',
        items: [{ link: 'mailto:team@example.com' }, { link: 'data:text/html,x' }],
      })
    );

    expect(Object.keys(priv().urlErrors()).sort()).toEqual(['items.1.link', 'url']);

    priv().form()?.get('url')?.setValue('https://example.com');
    expect(priv().urlErrors()['url']).toBeUndefined();
    priv().form()?.get('image')?.setValue('mailto:team@example.com');
    expect(priv().urlErrors()['image']).toContain('left out of the newsletter');
  });
});
