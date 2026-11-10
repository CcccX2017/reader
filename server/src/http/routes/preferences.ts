import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.ts';
import { authenticate, currentUser } from '../auth.ts';
import { preferenceDocument, PreferencesService } from '../../services/preferences.ts';

export function registerPreferenceRoutes(app: FastifyInstance, ctx: AppContext): void {
  const auth = authenticate(ctx);
  const preferences = new PreferencesService(ctx.db);

  app.get('/api/v1/preferences', { preHandler: auth }, async (request) => ({
    preferences: preferences.get(currentUser(request).id),
  }));

  app.put('/api/v1/preferences', { preHandler: auth }, async (request) => ({
    preferences: preferences.save(currentUser(request).id, preferenceDocument(request.body)),
  }));
}
