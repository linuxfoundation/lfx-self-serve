// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormControl, FormGroup } from '@angular/forms';
import { RICH_EDITOR_TOOLBAR_BUTTONS } from '@lfx-one/shared/constants';
import { describe, expect, it, vi } from 'vitest';
import { RichEditorComponent } from './rich-editor.component';

// These pin the settings that keep tiptap 3 behaving like tiptap 2 for saved content. Without them,
// clicking into an untouched form, or patching its value from code, marks the form dirty.

async function render(value: string) {
  const form = new FormGroup({ body: new FormControl(value) });
  TestBed.configureTestingModule({ providers: [{ provide: PLATFORM_ID, useValue: 'browser' }] });
  const fixture = TestBed.createComponent(RichEditorComponent);
  fixture.componentRef.setInput('form', form);
  fixture.componentRef.setInput('control', 'body');
  fixture.detectChanges();
  const component = fixture.componentInstance;
  await vi.waitFor(() => expect(component['editorReady']()).toBe(true));
  const editor = component['editor'];
  if (!editor) {
    throw new Error('editor did not initialize');
  }
  return { form, control: form.controls.body, component, editor };
}

describe('RichEditorComponent', () => {
  it.each([
    ['a list', '<p>Intro</p><ul><li><p>one</p></li><li><p>two</p></li></ul>'],
    ['a heading', '<h2>Title</h2><p>body</p><h3>Sub</h3>'],
  ])('leaves content ending in %s unchanged and pristine after focus and a selection change', async (_, html) => {
    const { control, editor } = await render(html);

    editor.commands.focus('end');
    editor.view.dispatch(editor.state.tr.setSelection(editor.state.selection));

    expect(editor.getHTML()).toBe(html);
    expect(control.value).toBe(html);
    expect(control.dirty).toBe(false);
  });

  it('applies an external value change to the editor without marking the control dirty', async () => {
    const { control, editor } = await render('<p>before</p>');
    const onUpdate = vi.fn();
    editor.on('update', onUpdate);

    control.setValue('<p>after</p>');

    expect(onUpdate).not.toHaveBeenCalled();
    expect(editor.getHTML()).toBe('<p>after</p>');
    expect(control.value).toBe('<p>after</p>');
    expect(control.dirty).toBe(false);
  });

  it('marks the control dirty and writes the HTML back when the user formats content', async () => {
    const { control, component, editor } = await render('<p>item</p>');
    const bullet = RICH_EDITOR_TOOLBAR_BUTTONS.find((button) => button.command === 'bulletList');
    const clear = RICH_EDITOR_TOOLBAR_BUTTONS.find((button) => button.command === 'clear');
    if (!bullet || !clear) {
      throw new Error('toolbar buttons missing');
    }

    editor.commands.selectAll();
    component['runCommand'](bullet);
    expect(control.value).toBe('<ul><li><p>item</p></li></ul>');
    expect(control.dirty).toBe(true);

    editor.commands.selectAll();
    component['runCommand'](clear);
    expect(control.value).toBe('<p>item</p>');
  });
});
