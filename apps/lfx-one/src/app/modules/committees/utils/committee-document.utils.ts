// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  CommitteeDocumentItem,
  MeetingAttachment,
  PastMeetingAttachment,
  PastMeetingRecording,
  PastMeetingSummary,
  RecordingFile,
} from '@lfx-one/shared/interfaces';
import { ALLOWED_RECORDING_FILE_TYPES, RECORDING_TYPE_LABELS } from '@lfx-one/shared/constants';

export function mapAttachmentToDoc(
  att: MeetingAttachment | PastMeetingAttachment,
  meetingTitle: string,
  meetingDate: string,
  meetingId: string,
  pastMeetingId: string | null
): CommitteeDocumentItem {
  const isLink = att.type === 'link';
  return {
    id: `att-${att.uid}`,
    name: att.name,
    source: isLink ? 'link' : 'file',
    addedBy: att.created_by?.name || null,
    date: att.created_at,
    fileSize: att.file_size ?? null,
    meetingTitle,
    meetingDate,
    meetingId,
    pastMeetingId,
    linkUrl: isLink ? att.link : undefined,
    attachmentUid: !isLink ? att.uid : undefined,
  };
}

export function mapRecordingFileToDoc(
  file: RecordingFile,
  shareUrl: string | null,
  meetingTitle: string,
  meetingDate: string,
  meetingId: string,
  pastMeetingId: string
): CommitteeDocumentItem {
  const isTranscript = file.file_type === 'TRANSCRIPT';
  return {
    id: `${isTranscript ? 'trs' : 'rec'}-${file.id}`,
    name: isTranscript ? 'Meeting Transcript' : getRecordingDisplayName(file),
    source: isTranscript ? 'transcript' : 'recording',
    addedBy: null,
    date: file.recording_start,
    fileSize: file.file_size ?? null,
    meetingTitle,
    meetingDate,
    meetingId,
    pastMeetingId,
    playUrl: isTranscript ? undefined : file.play_url,
    downloadUrl: file.download_url,
    shareUrl: isTranscript ? undefined : (shareUrl ?? undefined),
  };
}

export function mapSummaryToDoc(
  summary: PastMeetingSummary,
  meetingTitle: string,
  meetingDate: string,
  meetingId: string,
  pastMeetingId: string
): CommitteeDocumentItem {
  return {
    id: `sum-${summary.uid}`,
    name: summary.summary_data.title || 'AI Meeting Summary',
    source: 'summary',
    addedBy: null,
    date: summary.created_at,
    fileSize: null,
    meetingTitle,
    meetingDate,
    meetingId,
    pastMeetingId,
    summaryData: {
      uid: summary.uid,
      content: summary.summary_data.edited_content || summary.summary_data.content,
      approved: summary.approved,
    },
  };
}

export function getRecordingDisplayName(file: RecordingFile): string {
  const typeName = RECORDING_TYPE_LABELS[file.recording_type] || file.recording_type;
  return `${typeName} (${file.file_type})`;
}

export function getLargestSessionShareUrl(recording: PastMeetingRecording): string | null {
  if (!recording.sessions || recording.sessions.length === 0) {
    return null;
  }
  const largestSession = recording.sessions.reduce((largest, current) => (current.total_size > largest.total_size ? current : largest));
  return largestSession.share_url || null;
}

export function isAllowedRecordingFileType(fileType: string): boolean {
  return ALLOWED_RECORDING_FILE_TYPES.has(fileType);
}
