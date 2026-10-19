import express from 'express';
import { createErrorHandler } from './middleware/errorHandler.js';
import { notFound } from './middleware/notFound.js';
import { createTaskRouter } from './routes/task.routes.js';
import { createTaskService } from './services/task.service.js';

export function createApp({
  taskService = createTaskService(),
  env = process.env.NODE_ENV,
  logger = console,
} = {}) {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  const taskRouter = createTaskRouter(taskService);
  app.use('/api/tasks', taskRouter);
  // Original mount point, kept for backward compatibility.
  app.use('/tasks', taskRouter);

  app.use(notFound);
  app.use(createErrorHandler({ env, logger }));

  return app;
}
