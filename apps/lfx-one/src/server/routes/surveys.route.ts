// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { SurveyController } from '../controllers/survey.controller';
import { surveyWriteRateLimiter } from '../middleware/rate-limit.middleware';

const router = Router();

const surveyController = new SurveyController();

// POST /surveys - create a new survey
router.post('/', (req, res, next) => surveyController.createSurvey(req, res, next));

// GET /surveys - get all surveys
router.get('/', (req, res, next) => surveyController.getSurveys(req, res, next));

// GET /surveys/my-surveys - get surveys the current user has been invited to
router.get('/my-surveys', (req, res, next) => surveyController.getMySurveys(req, res, next));

// GET /surveys/:uid/my-response - current user's submitted response (Me lens drawer)
router.get('/:uid/my-response', (req, res, next) => surveyController.getMyResponse(req, res, next));

// GET /surveys/:uid/responses - paginated per-recipient responses (PMO results drawer)
router.get('/:uid/responses', (req, res, next) => surveyController.getSurveyResponses(req, res, next));

// POST /surveys/:uid/reminders - resend the survey email to selected non-respondents (#4340)
router.post('/:uid/reminders', surveyWriteRateLimiter, (req, res, next) => surveyController.sendSurveyReminders(req, res, next));

// GET /surveys/:uid/resync-preview - committee members a resync would add (#4340)
router.get('/:uid/resync-preview', (req, res, next) => surveyController.getResyncPreview(req, res, next));

// POST /surveys/:uid/resync - send the survey to committee members added since launch (#4340)
router.post('/:uid/resync', surveyWriteRateLimiter, (req, res, next) => surveyController.resyncRecipients(req, res, next));

// GET /surveys/:uid - get a single survey
router.get('/:uid', (req, res, next) => surveyController.getSurveyById(req, res, next));

// DELETE /surveys/:uid - delete a survey
router.delete('/:uid', (req, res, next) => surveyController.deleteSurvey(req, res, next));

export default router;
