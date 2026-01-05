// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input, output } from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { EditorModule, EditorSelectionChangeEvent, EditorTextChangeEvent } from 'primeng/editor';

type ToolbarOption = string | Record<string, unknown>;

@Component({
  selector: 'lfx-editor',
  imports: [EditorModule, ReactiveFormsModule],
  templateUrl: './editor.component.html',
  styleUrl: './editor.component.scss',
})
export class EditorComponent {
  // Required inputs
  public readonly form = input.required<FormGroup>();
  public readonly control = input.required<string>();

  // Optional inputs
  public readonly placeholder = input<string>('');
  public readonly style = input<Record<string, string>>({ height: '200px' });
  public readonly styleClass = input<string>('');
  public readonly readonly = input<boolean>(false);
  public readonly dataTest = input<string>();

  // Toolbar configuration - default includes requested options
  public readonly showToolbar = input<boolean>(true);
  public readonly toolbarOptions = input<ToolbarOption[][]>([
    ['bold', 'italic', 'underline', 'strike'],
    [{ list: 'ordered' }, { list: 'bullet' }],
    [{ align: ['center', 'right', 'justify'] }],
    ['link'],
    ['clean'],
  ]);

  // Events
  public readonly onTextChange = output<EditorTextChangeEvent>();
  public readonly onSelectionChange = output<EditorSelectionChangeEvent>();

  protected handleTextChange(event: EditorTextChangeEvent): void {
    this.onTextChange.emit(event);
  }

  protected handleSelectionChange(event: EditorSelectionChangeEvent): void {
    this.onSelectionChange.emit(event);
  }
}
