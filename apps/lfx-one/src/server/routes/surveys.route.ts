// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { SurveyController } from '../controllers/survey.controller';
import { blockDuringImpersonation } from '../middleware/impersonation-readonly.middleware';

const router = Router();

const surveyController = new SurveyController();

// Survey create and delete are blocked while impersonating — upstream would record them as the
// target. Reads stay open.

// POST /surveys - create a new survey
router.post('/', blockDuringImpersonation, (req, res, next) => surveyController.createSurvey(req, res, next));

// GET /surveys - get all surveys
router.get('/', (req, res, next) => surveyController.getSurveys(req, res, next));

// GET /surveys/my-surveys - get surveys the current user has been invited to
router.get('/my-surveys', (req, res, next) => surveyController.getMySurveys(req, res, next));

// GET /surveys/:uid/my-response - current user's submitted response (Me lens drawer)
router.get('/:uid/my-response', (req, res, next) => surveyController.getMyResponse(req, res, next));

// GET /surveys/:uid/responses - paginated per-recipient responses (PMO results drawer)
router.get('/:uid/responses', (req, res, next) => surveyController.getSurveyResponses(req, res, next));

// GET /surveys/:uid - get a single survey
router.get('/:uid', (req, res, next) => surveyController.getSurveyById(req, res, next));

// DELETE /surveys/:uid - delete a survey
router.delete('/:uid', blockDuringImpersonation, (req, res, next) => surveyController.deleteSurvey(req, res, next));

export default router;
