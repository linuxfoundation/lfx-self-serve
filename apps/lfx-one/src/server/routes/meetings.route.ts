// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ALLOWED_FILE_TYPES, MAX_FILE_SIZE_BYTES, sanitizeFilename } from '@lfx-one/shared';
import { NextFunction, Request, Response, Router } from 'express';

import { MeetingController } from '../controllers/meeting.controller';
import { ServiceValidationError } from '../errors';
import { AiService } from '../services/ai.service';
import { SupabaseService } from '../services/supabase.service';

const router = Router();

const supabaseService = new SupabaseService();
const aiService = new AiService();
const meetingController = new MeetingController();

// GET /meetings - get all meetings
router.get('/', (req, res, next) => meetingController.getMeetings(req, res, next));

// GET /meetings/count - get meetings count
router.get('/count', (req, res, next) => meetingController.getMeetingsCount(req, res, next));

// GET /meetings/:uid - get a single meeting
router.get('/:uid', (req, res, next) => meetingController.getMeetingById(req, res, next));

// POST /meetings - create a new meeting
router.post('/', (req, res, next) => meetingController.createMeeting(req, res, next));

// PUT /meetings/:uid - update a meeting
router.put('/:uid', (req, res, next) => meetingController.updateMeeting(req, res, next));

// DELETE /meetings/:uid - delete a meeting
router.delete('/:uid', (req, res, next) => meetingController.deleteMeeting(req, res, next));

// DELETE /meetings/:uid/occurrences/:occurrenceId - cancel a meeting occurrence
router.delete('/:uid/occurrences/:occurrenceId', (req, res, next) => meetingController.cancelOccurrence(req, res, next));

// Registrant routes
router.get('/:uid/registrants', (req, res, next) => meetingController.getMeetingRegistrants(req, res, next));

// POST /meetings/:uid/registrants - add registrants (handles single or multiple)
router.post('/:uid/registrants', (req, res, next) => meetingController.addMeetingRegistrants(req, res, next));

// PUT /meetings/:uid/registrants - update registrants (handles single or multiple)
router.put('/:uid/registrants', (req, res, next) => meetingController.updateMeetingRegistrants(req, res, next));

// DELETE /meetings/:uid/registrants - delete registrants (handles single or multiple)
router.delete('/:uid/registrants', (req, res, next) => meetingController.deleteMeetingRegistrants(req, res, next));

// POST /meetings/:uid/registrants/:registrantId/resend - resend invitation to specific registrant
router.post('/:uid/registrants/:registrantId/resend', (req, res, next) => meetingController.resendMeetingInvitation(req, res, next));

// RSVP routes
router.post('/:uid/rsvp', (req, res, next) => meetingController.createMeetingRsvp(req, res, next));
router.get('/:uid/rsvp', (req, res, next) => meetingController.getMeetingRsvps(req, res, next));
router.get('/:uid/rsvp/me', (req, res, next) => meetingController.getMeetingRsvpByUsername(req, res, next));

router.post('/:uid/attachments/upload', async (req: Request, res: Response, next: NextFunction) => {
  const startTime = Date.now();
  const meetingId = req.params['uid'];
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

      const validationError = ServiceValidationError.forField('uid', 'Meeting ID is required', {
        operation: 'upload_meeting_attachment',
        service: 'meetings_route',
        path: req.path,
      });

      return next(validationError);
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

      const validationError = ServiceValidationError.fromFieldErrors(
        {
          fileName: !fileName ? 'File name is required' : [],
          fileData: !fileData ? 'File data is required' : [],
          mimeType: !mimeType ? 'MIME type is required' : [],
        },
        'File data validation failed',
        {
          operation: 'upload_meeting_attachment',
          service: 'meetings_route',
          path: req.path,
        }
      );

      return next(validationError);
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

      const validationError = ServiceValidationError.forField('mimeType', 'File type not supported', {
        operation: 'upload_meeting_attachment',
        service: 'meetings_route',
        path: req.path,
      });

      return next(validationError);
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

      const validationError = ServiceValidationError.forField('fileData', 'File size too large (max 10MB)', {
        operation: 'upload_meeting_attachment',
        service: 'meetings_route',
        path: req.path,
      });

      return next(validationError);
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

router.delete('/:uid/attachments/:attachmentId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const meetingId = req.params['uid'];
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
      const validationError = ServiceValidationError.forField('mimeType', 'File type not supported', {
        operation: 'upload_meeting_attachment',
        service: 'meetings_route',
        path: req.path,
      });

      return next(validationError);
    }

    // Convert base64 to buffer
    const buffer = Buffer.from(fileData, 'base64');

    // Validate file size (10MB limit)
    if (buffer.length > MAX_FILE_SIZE_BYTES) {
      const validationError = ServiceValidationError.forField('fileData', 'File size too large (max 10MB)', {
        operation: 'upload_meeting_attachment',
        service: 'meetings_route',
        path: req.path,
      });

      return next(validationError);
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
router.post('/:uid/attachments', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const meetingId = req.params['uid'];
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

router.get('/:uid/attachments', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const meetingId = req.params['uid'];

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

// AI agenda generation endpoint
router.post('/generate-agenda', async (req: Request, res: Response, next: NextFunction) => {
  const startTime = Date.now();

  req.log.info(
    {
      operation: 'generate_agenda',
      meeting_type: req.body['meetingType'],
      has_context: !!req.body['context'],
    },
    'Starting AI agenda generation request'
  );

  try {
    const { meetingType, title, projectName, context } = req.body;

    // Validate required fields
    if (!meetingType || !title || !projectName) {
      return res.status(400).json({
        error: 'Missing required fields: meetingType, title, and projectName are required',
      });
    }

    const response = await aiService.generateMeetingAgenda({
      meetingType,
      title,
      projectName,
      context,
    });

    const duration = Date.now() - startTime;

    req.log.info(
      {
        operation: 'generate_agenda',
        duration,
        estimated_duration: response.estimatedDuration,
        status_code: 200,
      },
      'Successfully generated meeting agenda'
    );

    return res.json(response);
  } catch (error) {
    const duration = Date.now() - startTime;
    req.log.error(
      {
        error: error instanceof Error ? error.message : error,
        operation: 'generate_agenda',
        duration,
        meeting_type: req.body['meetingType'],
      },
      'Failed to generate meeting agenda'
    );
    return next(error);
  }
});

export default router;
