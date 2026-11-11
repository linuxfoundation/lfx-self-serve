// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MeetingAttachment } from '@lfx-one/shared/interfaces';
import { describe, expect, it } from 'vitest';

import { FileTypeDisplayPipe } from './file-type-display.pipe';

const icon = (fileName: string): string => new FileTypeDisplayPipe().transform({ name: fileName, file_name: fileName } as MeetingAttachment).icon;

describe('FileTypeDisplayPipe', () => {
  it('picks the icon from the file extension', () => {
    expect(icon('deck.pdf')).toBe('fa-light fa-file-pdf');
    expect(icon('charter.docx')).toBe('fa-light fa-file-word');
    expect(icon('roadmap.xlsx')).toBe('fa-light fa-file-excel');
    expect(icon('results.csv')).toBe('fa-light fa-file-excel');
    expect(icon('diagram.PNG')).toBe('fa-light fa-file-image');
    expect(icon('Agenda')).toBe('fa-light fa-file-lines');
  });
});
