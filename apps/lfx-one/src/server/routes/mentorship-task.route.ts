// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { MentorshipTaskController } from '../controllers/mentorship-task.controller';
import { blockDuringImpersonation } from '../middleware/impersonation-readonly.middleware';

const router = Router();
const taskController = new MentorshipTaskController();

// Shared by the admin and mentor program details; upstream checks the caller administers or mentors the program.
// Refused while impersonating: upstream would create or edit tasks as the impersonated user.
router.post('/', blockDuringImpersonation, (req, res, next) => taskController.createTasks(req, res, next));
router.patch('/:taskId', blockDuringImpersonation, (req, res, next) => taskController.updateTask(req, res, next));
// A read, so open while impersonating. Shared by the mentee and the task's reviewers; upstream checks the caller is one of them.
router.get('/:taskId/file', (req, res, next) => taskController.downloadTaskFile(req, res, next));

export default router;
