// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Meeting attachment entity with file metadata
 * @description Represents a file attached to a meeting with storage and tracking information
 */
export interface MeetingAttachment {
  /** Unique attachment identifier */
  id: string;
  /** Meeting this attachment belongs to */
  meeting_id: string;
  /** Original filename */
  file_name: string;
  /** Storage URL for the file */
  file_url: string;
  /** File size in bytes */
  file_size?: number;
  /** MIME type of the file */
  mime_type?: string;
  /** User ID who uploaded the file */
  uploaded_by?: string;
  /** Timestamp when attachment was created */
  created_at: string;
  /** Timestamp when attachment was last updated */
  updated_at?: string;
}

/**
 * Data required to create a meeting attachment
 * @description Input payload for attaching files to meetings
 */
export interface CreateMeetingAttachmentRequest {
  /** Meeting ID to attach file to */
  meeting_id: string;
  /** Original filename */
  file_name: string;
  /** Storage URL for the uploaded file */
  file_url: string;
  /** File size in bytes */
  file_size?: number;
  /** MIME type of the file */
  mime_type?: string;
  /** User ID uploading the file */
  uploaded_by?: string;
}

/**
 * Response from file upload service
 * @description Information about successfully uploaded file
 */
export interface UploadFileResponse {
  /** Public URL to access the uploaded file */
  url: string;
  /** Storage path of the uploaded file */
  path: string;
  /** File size in bytes */
  size: number;
  /** MIME type of the uploaded file */
  mimeType: string;
}

/**
 * Temporary attachment during upload process
 * @description Represents an attachment being uploaded with status tracking
 */
export interface PendingAttachment {
  /** Temporary identifier for the pending attachment */
  id: string;
  /** Original filename */
  fileName: string;
  /** Storage URL (available after upload) */
  fileUrl: string;
  /** File size in bytes */
  fileSize: number;
  /** MIME type of the file */
  mimeType: string;
  /** Whether upload is currently in progress */
  uploading?: boolean;
  /** Error message if upload failed */
  uploadError?: string;
}
