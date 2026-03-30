// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TagSeverity } from '../interfaces/components.interface';
import { CommitteeDocumentSource } from '../interfaces/committee.interface';

/** Recording type labels for human-readable display. */
export const RECORDING_TYPE_LABELS: Record<string, string> = {
  shared_screen_with_speaker_view: 'Shared Screen with Speaker View',
  shared_screen_with_gallery_view: 'Shared Screen with Gallery View',
  speaker_view: 'Speaker View',
  gallery_view: 'Gallery View',
  shared_screen: 'Shared Screen',
  audio_only: 'Audio Only',
  audio_transcript: 'Audio Transcript',
  active_speaker: 'Active Speaker',
};

/** Allowed recording file types — only these are surfaced in the documents tab. */
export const ALLOWED_RECORDING_FILE_TYPES = new Set(['MP4', 'M4A', 'TRANSCRIPT']);

/** Icon class for each document source type (FA icon only — color applied in Angular pipe). */
export const DOCUMENT_SOURCE_ICONS: Record<CommitteeDocumentSource, string> = {
  link: 'fa-light fa-link',
  file: 'fa-light fa-file',
  recording: 'fa-light fa-video',
  transcript: 'fa-light fa-file-lines',
  summary: 'fa-light fa-sparkles',
};

/** Tag configuration for each document source type. */
export const DOCUMENT_SOURCE_TAGS: Record<CommitteeDocumentSource, { value: string; severity: TagSeverity; icon: string }> = {
  link: { value: 'Link', severity: 'success', icon: 'fa-light fa-link' },
  file: { value: 'File', severity: 'warn', icon: 'fa-light fa-file' },
  recording: { value: 'Recording', severity: 'info', icon: 'fa-light fa-video' },
  transcript: { value: 'Transcript', severity: 'secondary', icon: 'fa-light fa-file-lines' },
  summary: { value: 'AI Summary', severity: 'contrast', icon: 'fa-light fa-sparkles' },
};
