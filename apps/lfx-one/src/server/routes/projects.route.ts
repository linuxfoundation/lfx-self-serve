// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { ProjectController } from '../controllers/project.controller';

const router = Router();

const projectController = new ProjectController();

// Project CRUD routes - using new controller pattern
router.get('/', (req, res, next) => projectController.getProjects(req, res, next));

router.get('/search', (req, res, next) => projectController.searchProjects(req, res, next));

router.get('/pending-action-surveys', (req, res, next) => projectController.getPendingActionSurveys(req, res, next));

router.get('/:slug', (req, res, next) => projectController.getProjectBySlug(req, res, next));

router.get('/:uid/permissions', (req, res, next) => projectController.getProjectPermissions(req, res, next));

router.post('/:uid/permissions', (req, res, next) => projectController.addUserToProjectPermissions(req, res, next));

router.put('/:uid/permissions/:username', (req, res, next) => projectController.updateUserPermissionRole(req, res, next));

router.delete('/:uid/permissions/:username', (req, res, next) => projectController.removeUserFromProjectPermissions(req, res, next));

export default router;
