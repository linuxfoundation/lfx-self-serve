// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { UserController } from '../controllers/user.controller';

const router = Router();
const userController = new UserController();

// GET /api/user/pending-actions - Get all pending actions for the authenticated user
router.get('/pending-actions', (req, res, next) => userController.getPendingActions(req, res, next));

// GET /api/user/meetings - Get all meetings for the authenticated user
router.get('/meetings', (req, res, next) => userController.getUserMeetings(req, res, next));

// GET /api/user/past-meetings - Get past meetings for the authenticated user
router.get('/past-meetings', (req, res, next) => userController.getUserPastMeetings(req, res, next));

// GET /api/user/latest-past-meetings - Get up to 5 most-recent past meetings (truly past, fast-path)
router.get('/latest-past-meetings', (req, res, next) => userController.getUserLatestPastMeetings(req, res, next));

// GET /api/user/salesforce-id - Proxy test for the API Gateway token
router.get('/salesforce-id', (req, res, next) => userController.getSalesforceId(req, res, next));

export default router;
