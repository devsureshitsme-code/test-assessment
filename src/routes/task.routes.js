import { Router } from 'express';
import { createTaskController } from '../controllers/task.controller.js';
import { validate } from '../middleware/validate.js';
import {
  createTaskSchema,
  taskIdParamsSchema,
  updateTaskSchema,
  updateTaskStatusSchema,
} from '../validation/task.schemas.js';

export function createTaskRouter(taskService) {
  const router = Router();
  const controller = createTaskController(taskService);

  router.post('/', validate({ body: createTaskSchema }), controller.create);
  router.get('/', controller.list);
  router.get('/:id', validate({ params: taskIdParamsSchema }), controller.getById);
  router.patch(
    '/:id',
    validate({ params: taskIdParamsSchema, body: updateTaskSchema }),
    controller.update,
  );
  router.patch(
    '/:id/status',
    validate({ params: taskIdParamsSchema, body: updateTaskStatusSchema }),
    controller.updateStatus,
  );

  return router;
}
