// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

export interface MeetingAttachment {
  id: string;
  meeting_id: string;
  file_name: string;
  file_url: string;
  file_size?: number;
  mime_type?: string;
  uploaded_by?: string;
  created_at: string;
  updated_at?: string;
}

export interface CreateMeetingAttachmentRequest {
  meeting_id: string;
  file_name: string;
  file_url: string;
  file_size?: number;
  mime_type?: string;
  uploaded_by?: string;
}

export interface UploadFileResponse {
  url: string;
  path: string;
  size: number;
  mimeType: string;
}

export interface PendingAttachment {
  id: string;
  fileName: string;
  fileUrl: string;
  fileSize: number;
  mimeType: string;
  uploading?: boolean;
  uploadError?: string;
}
