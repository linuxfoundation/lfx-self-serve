// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ALLOWED_FILE_TYPES, MAX_FILE_SIZE_BYTES, sanitizeFilename } from '@lfx-pcc/shared';
import { NextFunction, Request, Response, Router } from 'express';

import { SupabaseService } from '../services/supabase.service';

const router = Router();

const supabaseService = new SupabaseService();

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  const startTime = Date.now();

  req.log.info(
    {
      operation: 'fetch_meetings',
      query_params: req.query,
    },
    'Starting meetings fetch request'
  );

  try {
    const meetings = await supabaseService.getMeetings(req.query);
    const duration = Date.now() - startTime;

    req.log.info(
      {
        operation: 'fetch_meetings',
        meeting_count: meetings.length,
        duration,
        status_code: 200,
      },
      'Successfully fetched meetings'
    );

    return res.json(meetings);
  } catch (error) {
    const duration = Date.now() - startTime;
    req.log.error(
      {
        error: error instanceof Error ? error.message : error,
        operation: 'fetch_meetings',
        duration,
        query_params: req.query,
      },
      'Failed to fetch meetings'
    );
    return next(error);
  }
});

router.get('/:id/participants', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const meetingId = req.params['id'];

    if (!meetingId) {
      return res.status(400).json({
        error: 'Meeting ID is required',
        code: 'MISSING_MEETING_ID',
      });
    }

    const participants = await supabaseService.getMeetingParticipants(meetingId);

    return res.json(participants);
  } catch (error) {
    req.log.error(
      {
        error: error instanceof Error ? error.message : error,
        meeting_id: req.params['id'],
      },
      'Failed to fetch meeting participants'
    );
    return next(error);
  }
});

router.post('/:id/participants', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const meetingId = req.params['id'];
    const participantData = req.body;

    if (!meetingId) {
      return res.status(400).json({
        error: 'Meeting ID is required',
        code: 'MISSING_MEETING_ID',
      });
    }

    // Basic validation
    if (!participantData.first_name || !participantData.last_name || !participantData.email) {
      return res.status(400).json({
        error: 'First name, last name, and email are required fields',
        code: 'MISSING_REQUIRED_FIELDS',
      });
    }

    const participant = await supabaseService.addMeetingParticipant(meetingId, participantData);

    return res.status(201).json(participant);
  } catch (error) {
    req.log.error(
      {
        error: error instanceof Error ? error.message : error,
        meeting_id: req.params['id'],
      },
      'Failed to add meeting participant'
    );
    return next(error);
  }
});

router.put('/:id/participants/:participantId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const meetingId = req.params['id'];
    const participantId = req.params['participantId'];
    const participantData = req.body;

    if (!meetingId) {
      return res.status(400).json({
        error: 'Meeting ID is required',
        code: 'MISSING_MEETING_ID',
      });
    }

    if (!participantId) {
      return res.status(400).json({
        error: 'Participant ID is required',
        code: 'MISSING_PARTICIPANT_ID',
      });
    }

    // Basic validation
    if (!participantData.first_name || !participantData.last_name || !participantData.email) {
      return res.status(400).json({
        error: 'First name, last name, and email are required fields',
        code: 'MISSING_REQUIRED_FIELDS',
      });
    }

    // Remove fields that shouldn't be updated directly
    delete participantData.id;
    delete participantData.meeting_id;
    delete participantData.created_at;

    const participant = await supabaseService.updateMeetingParticipant(meetingId, participantId, participantData);

    return res.json(participant);
  } catch (error) {
    req.log.error(
      {
        error: error instanceof Error ? error.message : error,
        meeting_id: req.params['id'],
        participant_id: req.params['participantId'],
      },
      'Failed to update meeting participant'
    );
    return next(error);
  }
});

router.delete('/:id/participants/:participantId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const meetingId = req.params['id'];
    const participantId = req.params['participantId'];

    if (!meetingId) {
      return res.status(400).json({
        error: 'Meeting ID is required',
        code: 'MISSING_MEETING_ID',
      });
    }

    if (!participantId) {
      return res.status(400).json({
        error: 'Participant ID is required',
        code: 'MISSING_PARTICIPANT_ID',
      });
    }

    await supabaseService.deleteMeetingParticipant(meetingId, participantId);

    return res.status(204).send();
  } catch (error) {
    req.log.error(
      {
        error: error instanceof Error ? error.message : error,
        meeting_id: req.params['id'],
        participant_id: req.params['participantId'],
      },
      'Failed to delete meeting participant'
    );
    return next(error);
  }
});

router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  const startTime = Date.now();
  const meetingId = req.params['id'];

  req.log.info(
    {
      operation: 'fetch_meeting_by_id',
      meeting_id: meetingId,
    },
    'Starting meeting fetch by ID request'
  );

  try {
    if (!meetingId) {
      req.log.warn(
        {
          operation: 'fetch_meeting_by_id',
          error: 'Missing meeting ID parameter',
          status_code: 400,
        },
        'Bad request: Meeting ID validation failed'
      );

      return res.status(400).json({
        error: 'Meeting ID is required',
        code: 'MISSING_MEETING_ID',
      });
    }

    const meeting = await supabaseService.getMeetingById(meetingId);
    const duration = Date.now() - startTime;

    if (!meeting) {
      req.log.warn(
        {
          operation: 'fetch_meeting_by_id',
          meeting_id: meetingId,
          error: 'Meeting not found',
          duration,
          status_code: 404,
        },
        'Meeting not found'
      );

      return res.status(404).json({
        error: 'Meeting not found',
        code: 'MEETING_NOT_FOUND',
      });
    }

    req.log.info(
      {
        operation: 'fetch_meeting_by_id',
        meeting_id: meetingId,
        duration,
        status_code: 200,
      },
      'Successfully fetched meeting'
    );

    return res.json(meeting);
  } catch (error) {
    const duration = Date.now() - startTime;
    req.log.error(
      {
        error: error instanceof Error ? error.message : error,
        operation: 'fetch_meeting_by_id',
        meeting_id: meetingId,
        duration,
      },
      'Failed to fetch meeting'
    );
    return next(error);
  }
});

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  const startTime = Date.now();
  const meetingData = req.body;

  req.log.info(
    {
      operation: 'create_meeting',
      project_uid: meetingData?.project_uid,
      start_time: meetingData?.start_time,
      duration_minutes: meetingData?.duration,
      body_size: JSON.stringify(req.body).length,
    },
    'Starting meeting creation request'
  );

  try {
    // Basic validation
    if (!meetingData.topic || !meetingData.start_time || !meetingData.project_uid || !meetingData.duration) {
      req.log.warn(
        {
          operation: 'create_meeting',
          error: 'Missing required fields for meeting creation',
          provided_fields: {
            has_topic: !!meetingData.topic,
            has_start_time: !!meetingData.start_time,
            has_project_uid: !!meetingData.project_uid,
            has_duration: !!meetingData.duration,
          },
          status_code: 400,
        },
        'Bad request: Meeting required fields validation failed'
      );

      return res.status(400).json({
        error: 'Topic, start_time, duration, and project_uid are required fields',
        code: 'MISSING_REQUIRED_FIELDS',
      });
    }

    const meeting = await supabaseService.createMeeting(meetingData);
    const duration = Date.now() - startTime;

    req.log.info(
      {
        operation: 'create_meeting',
        meeting_id: meeting.id,
        project_uid: meeting.project_uid,
        duration,
        status_code: 201,
      },
      'Successfully created meeting'
    );

    return res.status(201).json(meeting);
  } catch (error) {
    const duration = Date.now() - startTime;
    req.log.error(
      {
        error: error instanceof Error ? error.message : error,
        operation: 'create_meeting',
        project_uid: req.body?.project_uid,
        duration,
      },
      'Failed to create meeting'
    );
    return next(error);
  }
});

router.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const meetingId = req.params['id'];
    const meetingData = req.body;
    const { editType } = req.query;

    if (!meetingId) {
      return res.status(400).json({
        error: 'Meeting ID is required',
        code: 'MISSING_MEETING_ID',
      });
    }

    // Validate editType for recurring meetings
    if (editType && !['single', 'future'].includes(editType as string)) {
      return res.status(400).json({
        error: 'Edit type must be "single" or "future"',
        code: 'INVALID_EDIT_TYPE',
      });
    }

    // Remove fields that shouldn't be updated directly
    delete meetingData.id;
    delete meetingData.created_at;

    const meeting = await supabaseService.updateMeeting(meetingId, meetingData, editType as 'single' | 'future');

    return res.json(meeting);
  } catch (error) {
    req.log.error(
      {
        error: error instanceof Error ? error.message : error,
        meeting_id: req.params['id'],
        edit_type: req.query['editType'],
      },
      'Failed to update meeting'
    );
    return next(error);
  }
});

router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const meetingId = req.params['id'];
    const { deleteType } = req.query;

    if (!meetingId) {
      return res.status(400).json({
        error: 'Meeting ID is required',
        code: 'MISSING_MEETING_ID',
      });
    }

    // Validate deleteType for recurring meetings
    if (deleteType && !['single', 'series', 'future'].includes(deleteType as string)) {
      return res.status(400).json({
        error: 'Delete type must be "single", "series", or "future"',
        code: 'INVALID_DELETE_TYPE',
      });
    }

    await supabaseService.deleteMeeting(meetingId, deleteType as 'single' | 'series' | 'future');

    return res.status(204).send();
  } catch (error) {
    req.log.error(
      {
        error: error instanceof Error ? error.message : error,
        meeting_id: req.params['id'],
        delete_type: req.query['deleteType'],
      },
      'Failed to delete meeting'
    );
    return next(error);
  }
});

router.post('/:id/attachments/upload', async (req: Request, res: Response, next: NextFunction) => {
  const startTime = Date.now();
  const meetingId = req.params['id'];
  const { fileName, fileData, mimeType, fileSize } = req.body;

  req.log.info(
    {
      operation: 'upload_meeting_attachment',
      meeting_id: meetingId,
      mime_type: mimeType,
      file_size: fileSize,
      has_file_data: !!fileData,
      file_size_bytes: fileData ? Buffer.from(fileData, 'base64').length : 0,
    },
    'Starting meeting attachment upload request'
  );

  try {
    if (!meetingId) {
      req.log.warn(
        {
          operation: 'upload_meeting_attachment',
          error: 'Missing meeting ID parameter',
          status_code: 400,
        },
        'Bad request: Meeting ID validation failed'
      );

      return res.status(400).json({
        error: 'Meeting ID is required',
        code: 'MISSING_MEETING_ID',
      });
    }

    if (!fileName || !fileData || !mimeType) {
      req.log.warn(
        {
          operation: 'upload_meeting_attachment',
          meeting_id: meetingId,
          error: 'Missing required file data',
          provided_fields: {
            has_file_name: !!fileName,
            has_file_data: !!fileData,
            has_mime_type: !!mimeType,
          },
          status_code: 400,
        },
        'Bad request: File data validation failed'
      );

      return res.status(400).json({
        error: 'fileName, fileData, and mimeType are required',
        code: 'MISSING_FILE_DATA',
      });
    }

    // Validate file type
    if (!ALLOWED_FILE_TYPES.includes(mimeType as (typeof ALLOWED_FILE_TYPES)[number])) {
      req.log.warn(
        {
          operation: 'upload_meeting_attachment',
          meeting_id: meetingId,
          mime_type: mimeType,
          error: 'Unsupported file type',
          allowed_types: ALLOWED_FILE_TYPES,
          status_code: 400,
        },
        'Bad request: File type validation failed'
      );

      return res.status(400).json({
        error: 'File type not supported',
        code: 'UNSUPPORTED_FILE_TYPE',
      });
    }

    // Convert base64 to buffer
    const buffer = Buffer.from(fileData, 'base64');

    // Validate file size (10MB limit)
    if (buffer.length > MAX_FILE_SIZE_BYTES) {
      req.log.warn(
        {
          operation: 'upload_meeting_attachment',
          meeting_id: meetingId,
          actual_file_size: buffer.length,
          max_file_size: MAX_FILE_SIZE_BYTES,
          error: 'File size exceeds limit',
          status_code: 400,
        },
        'Bad request: File size validation failed'
      );

      return res.status(400).json({
        error: 'File size too large (max 10MB)',
        code: 'FILE_TOO_LARGE',
      });
    }

    // Generate unique file path: meetings/{meetingId}/{timestamp}_{filename}
    const timestamp = Date.now();
    const sanitizedFilename = sanitizeFilename(fileName);
    const filePath = `meetings/${meetingId}/${timestamp}_${sanitizedFilename}`;

    req.log.debug(
      {
        operation: 'upload_meeting_attachment',
        meeting_id: meetingId,
        file_path: filePath,
        file_size: buffer.length,
      },
      'Uploading file to storage'
    );

    // Upload to Supabase Storage
    const uploadResult = await supabaseService.uploadFile(filePath, buffer, {
      contentType: mimeType,
      upsert: true,
      cacheControl: '3600',
    });

    // Create attachment record in database
    const attachment = await supabaseService.createMeetingAttachment({
      meeting_id: meetingId,
      file_name: fileName,
      file_url: uploadResult.url,
      file_size: fileSize || buffer.length,
      mime_type: mimeType,
      // uploaded_by: req.user?.id, // TODO: Add user ID from auth context
    });

    const duration = Date.now() - startTime;
    req.log.info(
      {
        operation: 'upload_meeting_attachment',
        meeting_id: meetingId,
        attachment_id: attachment.id,
        file_size: buffer.length,
        duration,
        status_code: 201,
      },
      'Successfully uploaded meeting attachment'
    );

    return res.status(201).json({
      message: 'File uploaded successfully',
      attachment,
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    req.log.error(
      {
        error: error instanceof Error ? error.message : error,
        operation: 'upload_meeting_attachment',
        meeting_id: meetingId,
        file_size: fileSize,
        duration,
      },
      'Failed to upload meeting attachment'
    );
    return next(error);
  }
});

router.delete('/:id/attachments/:attachmentId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const meetingId = req.params['id'];
    const attachmentId = req.params['attachmentId'];

    if (!meetingId) {
      return res.status(400).json({
        error: 'Meeting ID is required',
        code: 'MISSING_MEETING_ID',
      });
    }

    if (!attachmentId) {
      return res.status(400).json({
        error: 'Attachment ID is required',
        code: 'MISSING_ATTACHMENT_ID',
      });
    }

    // Get attachment details to extract file path for deletion
    const attachments = await supabaseService.getMeetingAttachments(meetingId);
    const attachment = attachments.find((a) => a.id === attachmentId);

    if (!attachment) {
      return res.status(404).json({
        error: 'Attachment not found',
        code: 'ATTACHMENT_NOT_FOUND',
      });
    }

    // Extract file path from URL for deletion
    const urlParts = attachment.file_url.split('/');
    const pathIndex = urlParts.findIndex((part) => part === 'meetings');
    if (pathIndex !== -1) {
      const filePath = urlParts.slice(pathIndex).join('/');

      try {
        // Delete from storage (continue even if this fails)
        await supabaseService.deleteFile([filePath]);
      } catch (storageError) {
        req.log.warn({ error: storageError }, 'Failed to delete file from storage');
      }
    }

    // Delete attachment record from database
    await supabaseService.deleteMeetingAttachment(attachmentId);

    return res.status(204).send();
  } catch (error) {
    req.log.error(
      {
        error: error instanceof Error ? error.message : error,
        meeting_id: req.params['id'],
        attachment_id: req.params['attachmentId'],
      },
      'Failed to delete meeting attachment'
    );
    return next(error);
  }
});

// General storage upload endpoint (not tied to specific meeting)
router.post('/storage/upload', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { fileName, fileData, mimeType, filePath } = req.body;

    if (!fileName || !fileData || !mimeType || !filePath) {
      return res.status(400).json({
        error: 'fileName, fileData, mimeType, and filePath are required',
        code: 'MISSING_FILE_DATA',
      });
    }

    // Validate file type
    if (!ALLOWED_FILE_TYPES.includes(mimeType as (typeof ALLOWED_FILE_TYPES)[number])) {
      return res.status(400).json({
        error: 'File type not supported',
        code: 'UNSUPPORTED_FILE_TYPE',
      });
    }

    // Convert base64 to buffer
    const buffer = Buffer.from(fileData, 'base64');

    // Validate file size (10MB limit)
    if (buffer.length > MAX_FILE_SIZE_BYTES) {
      return res.status(400).json({
        error: 'File size too large (max 10MB)',
        code: 'FILE_TOO_LARGE',
      });
    }

    // Upload to Supabase Storage
    const uploadResult = await supabaseService.uploadFile(filePath, buffer, {
      contentType: mimeType,
      upsert: true,
      cacheControl: '3600',
    });

    return res.status(201).json(uploadResult);
  } catch (error) {
    req.log.error(
      {
        error: error instanceof Error ? error.message : error,
        file_path: req.body?.filePath,
      },
      'Failed to upload file to storage'
    );
    return next(error);
  }
});

// Meeting attachment routes
router.post('/:id/attachments', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const meetingId = req.params['id'];
    const attachmentData = req.body;

    if (!meetingId) {
      return res.status(400).json({
        error: 'Meeting ID is required',
        code: 'MISSING_MEETING_ID',
      });
    }

    if (!attachmentData.file_name || !attachmentData.file_url) {
      return res.status(400).json({
        error: 'file_name and file_url are required',
        code: 'MISSING_ATTACHMENT_DATA',
      });
    }

    const attachment = await supabaseService.createMeetingAttachment({
      meeting_id: meetingId,
      file_name: attachmentData.file_name,
      file_url: attachmentData.file_url,
      file_size: attachmentData.file_size,
      mime_type: attachmentData.mime_type,
      uploaded_by: attachmentData.uploaded_by,
    });

    return res.status(201).json(attachment);
  } catch (error) {
    req.log.error(
      {
        error: error instanceof Error ? error.message : error,
        meeting_id: req.params['id'],
      },
      'Failed to create meeting attachment'
    );
    return next(error);
  }
});

router.get('/:id/attachments', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const meetingId = req.params['id'];

    if (!meetingId) {
      return res.status(400).json({
        error: 'Meeting ID is required',
        code: 'MISSING_MEETING_ID',
      });
    }

    const attachments = await supabaseService.getMeetingAttachments(meetingId);

    return res.json(attachments);
  } catch (error) {
    req.log.error(
      {
        error: error instanceof Error ? error.message : error,
        meeting_id: req.params['id'],
      },
      'Failed to fetch meeting attachments'
    );
    return next(error);
  }
});

export default router;
