// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { SurveyController } from '../controllers/survey.controller';

const router = Router();

const surveyController = new SurveyController();

// POST /surveys - create a new survey
router.post('/', (req, res, next) => surveyController.createSurvey(req, res, next));

// GET /surveys - get all surveys
router.get('/', (req, res, next) => surveyController.getSurveys(req, res, next));

// GET /surveys/my-surveys - get surveys the current user has been invited to
router.get('/my-surveys', (req, res, next) => surveyController.getMySurveys(req, res, next));

// GET /surveys/:uid - get a single survey
router.get('/:uid', (req, res, next) => surveyController.getSurveyById(req, res, next));

// DELETE /surveys/:uid - delete a survey
router.delete('/:uid', (req, res, next) => surveyController.deleteSurvey(req, res, next));

export default router;
