import { Router } from 'express';
import { authRouter } from './auth.js';
import { dashboardRouter } from './dashboard.js';
import { integrationsRouter } from './integrations.js';
import { inventoryRouter } from './inventory.js';
import { ordersRouter } from './orders.js';
import { packingRouter } from './packing.js';
import { productsRouter } from './products.js';
import { usersRouter } from './users.js';
import { financeRouter } from './finance.js';
import { reportsRouter } from './reports.js';
import { returnsRouter } from './returns.js';
import { shipmentsRouter } from './shipments.js';
import { requireAuth, requireCsrf } from '../middleware.js';

export const apiRouter = Router();

apiRouter.get('/health', (_req, res) => res.json({ status: 'ok', service: 'sellflow-commerce-os' }));
apiRouter.use('/auth', authRouter);

apiRouter.use(requireAuth);
apiRouter.use((req, res, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return requireCsrf(req, res, next);
  next();
});

apiRouter.use('/users', usersRouter);
apiRouter.use('/dashboard', dashboardRouter);
apiRouter.use('/products', productsRouter);
apiRouter.use('/inventory', inventoryRouter);
apiRouter.use('/orders', ordersRouter);
apiRouter.use('/packing', packingRouter);
apiRouter.use('/shipments', shipmentsRouter);
apiRouter.use('/returns', returnsRouter);
apiRouter.use('/finance', financeRouter);
apiRouter.use('/reports', reportsRouter);
apiRouter.use('/integrations', integrationsRouter);
