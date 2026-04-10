// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Valid attachment category values
 */
export type AttachmentCategory = 'Meeting Minutes' | 'Notes' | 'Presentation' | 'Other';

/**
 * User info embedded in attachment responses
 */
export interface AttachmentUserInfo {
  /** Username of the user */
  username: string;
  /** Email address of the user */
  email: string;
  /** Display name of the user */
  name: string;
}

/**
 * Meeting attachment entity aligned with ITX proxy API response
 * @description Represents a file or link attached to a scheduled meeting
 */
export interface MeetingAttachment {
  /** Unique attachment identifier */
  uid: string;
  /** Meeting this attachment belongs to */
  meeting_id: string;
  /** Attachment type: 'file' for uploaded files, 'link' for external URLs */
  type: 'file' | 'link';
  /** Category of the attachment */
  category?: AttachmentCategory;
  /** Attachment name/title */
  name: string;
  /** Optional description */
  description?: string;
  /** External link URL (only for type='link') */
  link?: string;
  /** Whether the file has been uploaded (only for type='file') */
  file_uploaded?: boolean;
  /** Original file name (only for type='file') */
  file_name?: string;
  /** File size in bytes (only for type='file') */
  file_size?: number;
  /** Storage URL for the file (only for type='file') */
  file_url?: string;
  /** Upload status: 'ongoing' | 'completed' | 'failed' (only for type='file') */
  file_upload_status?: string;
  /** MIME type of the file (only for type='file') */
  file_content_type?: string;
  /** Timestamp when attachment was created */
  created_at: string;
  /** User who created the attachment */
  created_by?: AttachmentUserInfo;
  /** Timestamp when attachment was last updated */
  updated_at?: string;
  /** User who last updated the attachment */
  updated_by?: AttachmentUserInfo;
}

/**
 * Past meeting attachment entity aligned with ITX proxy API response
 * @description Represents a file or link attached to a past meeting occurrence
 */
export interface PastMeetingAttachment {
  /** Unique attachment identifier */
  uid: string;
  /** Hyphenated meeting and occurrence ID (e.g., "12343245463-1630560600000") */
  meeting_and_occurrence_id: string;
  /** Attachment type: 'file' for uploaded files, 'link' for external URLs */
  type: 'file' | 'link';
  /** Category of the attachment */
  category?: AttachmentCategory;
  /** Attachment name/title */
  name: string;
  /** Optional description */
  description?: string;
  /** External link URL (only for type='link') */
  link?: string;
  /** Whether the file has been uploaded (only for type='file') */
  file_uploaded?: boolean;
  /** Original file name (only for type='file') */
  file_name?: string;
  /** File size in bytes (only for type='file') */
  file_size?: number;
  /** Storage URL for the file (only for type='file') */
  file_url?: string;
  /** Upload status: 'ongoing' | 'completed' | 'failed' (only for type='file') */
  file_upload_status?: string;
  /** MIME type of the file (only for type='file') */
  file_content_type?: string;
  /** Timestamp when attachment was created */
  created_at: string;
  /** User who created the attachment */
  created_by?: AttachmentUserInfo;
  /** Timestamp when attachment was last updated */
  updated_at?: string;
  /** User who last updated the attachment */
  updated_by?: AttachmentUserInfo;
}

/**
 * Normalized attachment item for unified template rendering.
 * Merges the common fields from MeetingAttachment and PastMeetingAttachment
 * so a single template block can render both.
 */
export interface MeetingResourceItem {
  /** Unique attachment identifier */
  uid: string;
  /** Attachment type: 'link' for external URLs, 'file' for uploaded files */
  type: 'file' | 'link';
  /** Attachment name/title */
  name: string;
  /** External link URL (only for type='link') */
  link?: string;
  /** Direct download URL for past meeting files */
  fileUrl?: string;
  /** File size in bytes (only for past meeting files) */
  fileSize?: number;
  /** Whether this resource is from a past meeting (direct download) vs future meeting (requires API call) */
  isPastMeeting: boolean;
}

/**
 * Request body for creating a link-type attachment
 */
export interface CreateLinkAttachmentRequest {
  /** Must be 'link' */
  type: 'link';
  /** Category of the attachment — defaults to 'Other' if omitted */
  category?: AttachmentCategory;
  /** Name/title of the attachment */
  name: string;
  /** Optional description */
  description?: string;
  /** External URL to link */
  link: string;
}

/**
 * Request body for creating a file-type attachment record
 * (used after the file has been uploaded via presigned URL)
 */
export interface CreateFileAttachmentRequest {
  /** Must be 'file' */
  type: 'file';
  /** Category of the attachment — required by the meeting service */
  category: AttachmentCategory;
  /** Name/title of the attachment */
  name: string;
  /** Optional description */
  description?: string;
}

/**
 * Union type for creating any attachment
 */
export type CreateMeetingAttachmentRequest = CreateLinkAttachmentRequest | CreateFileAttachmentRequest;

/**
 * Request body for updating an existing attachment.
 * The meeting service performs a full replacement — type, category, and name
 * must always be provided.
 */
export interface UpdateMeetingAttachmentRequest {
  /** Attachment type — required */
  type: 'file' | 'link';
  /** Attachment category — required */
  category: AttachmentCategory;
  /** Attachment name/title — required */
  name: string;
  /** Optional description */
  description?: string;
  /** External URL (for link type) */
  link?: string;
}

/**
 * Request body for generating a presigned upload URL
 */
export interface PresignAttachmentRequest {
  /** File name with extension */
  name: string;
  /** File size in bytes */
  file_size: number;
  /** MIME type of the file */
  file_type: string;
  /** Optional description */
  description?: string;
  /** Optional attachment category */
  category?: AttachmentCategory;
}

/**
 * Response from the presign endpoint
 * Contains the presigned S3 URL and the created attachment record
 */
export interface PresignAttachmentResponse {
  /** UUID of the created (pending) attachment */
  uid: string;
  /** Meeting or past meeting ID */
  meeting_id?: string;
  /** Presigned S3 URL to upload the file to via HTTP PUT */
  file_url: string;
  /** Attachment type */
  type: 'file';
  /** Attachment category */
  category?: AttachmentCategory;
  /** Attachment name */
  name: string;
  /** Original file name */
  file_name: string;
  /** File size in bytes */
  file_size: number;
  /** Upload status (will be 'ongoing' until S3 event confirms the upload) */
  file_upload_status: string;
  /** MIME type */
  file_content_type?: string;
  /** Creation timestamp */
  created_at: string;
  /** Creator info */
  created_by?: AttachmentUserInfo;
}

/**
 * Response from the attachment download URL endpoint
 */
export interface AttachmentDownloadUrlResponse {
  /** Time-limited presigned download URL */
  download_url: string;
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
  /** The actual File object to be uploaded */
  file: File;
  /** File size in bytes */
  fileSize: number;
  /** MIME type of the file */
  mimeType: string;
  /** Whether upload is currently in progress */
  uploading?: boolean;
  /** Whether upload completed successfully */
  uploaded?: boolean;
  /** Error message if upload failed */
  uploadError?: string;
}
