import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.ts';
import { publishedImageDigest } from '../../lib/image-digest.ts';
import { releaseEvents } from '../../lib/release.ts';

/** Pushes the release in service to every open page. No token: it carries no account data. */
export function registerEventRoutes(app: FastifyInstance, ctx: AppContext): void {
  // The same snapshot the event stream opens with, for a check the reader starts.
  app.get('/api/v1/release', async (_request, reply) => {
    const hub = ctx.release;
    if (!hub) return reply.status(503).send({ error: { code: 'RELEASE_UNAVAILABLE', message: '版本通知还没准备好' } });
    const snapshot = hub.snapshot();
    const published = await publishedImageDigest(snapshot.server);
    return published ? { ...snapshot, image: published.digest, imageTag: published.tag } : snapshot;
  });

  app.get('/api/v1/events', (request, reply) => {
    const hub = ctx.release;
    if (!hub) return reply.status(503).send({ error: { code: 'RELEASE_UNAVAILABLE', message: '版本通知还没准备好' } });
    reply.header('content-type', 'text/event-stream; charset=utf-8');
    reply.header('cache-control', 'no-cache, no-transform');
    reply.header('x-accel-buffering', 'no');
    const controller = new AbortController();
    const abort = () => controller.abort();
    request.raw.once('aborted', abort);
    reply.raw.once('close', abort);
    return reply.send(releaseEvents(hub, controller.signal));
  });
}
