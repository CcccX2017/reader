import { createReadStream, existsSync } from 'node:fs';
import type { Readable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.ts';
import { authenticate, currentUser, requireAdmin } from '../auth.ts';
import { RegistrationService } from '../../services/registration.ts';
import { AVATAR_MAX_BYTES } from '../../services/avatars.ts';
import { badRequest, notFound } from '../../lib/errors.ts';
import { imageContentType } from '../../indexer/formats/image-types.ts';
import { assertSafeRel, resolveInside } from '../../lib/paths.ts';

interface Credentials {
  username?: string;
  password?: string;
  displayName?: string;
  inviteCode?: string;
}

export function registerAuthRoutes(app: FastifyInstance, ctx: AppContext): void {
  const authenticateFn = authenticate(ctx);
  const registration = new RegistrationService(ctx.db);

  app.get('/api/v1/admin/registration', {preHandler:authenticateFn}, async request => {
    requireAdmin(request); return {mode:registration.mode(),invites:registration.invites()};
  });
  app.patch('/api/v1/admin/registration', {preHandler:authenticateFn}, async request => {
    requireAdmin(request); registration.setMode((request.body as {mode?:unknown})?.mode); return {mode:registration.mode()};
  });
  app.post('/api/v1/admin/invites', {preHandler:authenticateFn}, async (request,reply) => {
    requireAdmin(request); const body=(request.body ?? {}) as {label?:unknown;maxUses?:unknown;days?:unknown};
    const result=registration.create(body.label ?? '',body.maxUses ?? 1,body.days ?? 7); reply.status(201); return result;
  });
  app.delete('/api/v1/admin/invites/:id', {preHandler:authenticateFn}, async request => {
    requireAdmin(request); registration.disable((request.params as {id:string}).id); return {ok:true};
  });
  app.post('/api/v1/admin/users/:id/password', {preHandler:authenticateFn}, async request => {
    requireAdmin(request); const {id}=request.params as {id:string};
    if (id===currentUser(request).id) throw badRequest('请使用个人修改密码功能','SELF_LOCKOUT');
    const password=(request.body as {password?:unknown})?.password;
    if (typeof password!=='string') throw badRequest('请填写新密码');
    await ctx.users.resetPassword(id,password); return {ok:true};
  });

  app.post('/api/v1/auth/register', async (request, reply) => {
    const body = (request.body ?? {}) as Credentials;
    if (typeof body.username!=='string' || typeof body.password!=='string' || !body.username || !body.password || body.username.length>100 || body.password.length>1024 || (body.displayName!==undefined && (typeof body.displayName!=='string' || body.displayName.length>100))) throw badRequest('请填写有效的用户名、密码和显示名');
    if (!ctx.users.canRegisterPublicly()) {
      throw badRequest('public registration is disabled on this instance', 'REGISTRATION_DISABLED');
    }
    const user = await ctx.users.create({
      username: body.username,
      password: body.password,
      ...(body.displayName !== undefined ? { displayName: body.displayName } : {}),
    }, () => registration.admit(body.inviteCode));
    const session = await ctx.users.login(body.username, body.password, request.headers['user-agent'] ?? '');
    reply.status(201);
    return { user, session };
  });

  app.post('/api/v1/auth/login', async (request) => {
    const body = (request.body ?? {}) as Credentials;
    if (!body.username || !body.password) throw badRequest('username and password are required');
    const session = await ctx.users.login(body.username, body.password, request.headers['user-agent'] ?? '');
    return session;
  });

  app.post('/api/v1/auth/refresh', async (request) => {
    const body = (request.body ?? {}) as { refreshToken?: string };
    if (!body.refreshToken) throw badRequest('refreshToken is required');
    return ctx.users.refresh(body.refreshToken);
  });

  app.post('/api/v1/auth/logout', async (request) => {
    const body = (request.body ?? {}) as { refreshToken?: string };
    // Logout is idempotent: a client that is already signed out must not error.
    if (body.refreshToken) ctx.users.revokeByToken(body.refreshToken);
    return { ok: true };
  });

  app.get('/api/v1/auth/me', { preHandler: authenticateFn }, async (request) => {
    return { user: currentUser(request) };
  });

  app.patch('/api/v1/auth/me', { preHandler: authenticateFn }, async (request) => {
    const user = currentUser(request);
    const body = (request.body ?? {}) as { displayName?: unknown };
    if (typeof body.displayName !== 'string') throw badRequest('请填写显示名');
    if (body.displayName.length > 100) throw badRequest('显示名最多 100 个字', 'DISPLAY_NAME_TOO_LONG');
    return { user: ctx.users.setDisplayName(user.id, body.displayName) };
  });

  /** Replaces the signed-in user's avatar. A new upload overwrites the previous file. */
  app.post('/api/v1/auth/avatar', { preHandler: authenticateFn }, async (request) => {
    const user = currentUser(request);
    if (!request.isMultipart()) throw badRequest('expected multipart/form-data', 'NOT_MULTIPART');
    let bytes: Buffer | null = null;
    for await (const part of request.parts()) {
      if (part.type !== 'file') continue;
      if (bytes) {
        part.file.resume();
        continue;
      }
      bytes = await readAvatarBytes(part.file);
    }
    if (!bytes) throw badRequest('没有上传头像图片', 'NO_FILE');
    return { user: await ctx.users.setAvatar(user.id, bytes) };
  });

  app.delete('/api/v1/auth/avatar', { preHandler: authenticateFn }, async (request) => {
    const user = currentUser(request);
    return { user: await ctx.users.clearAvatar(user.id) };
  });

  /** Serves a user's avatar. Authenticated; `<img>` may pass `access_token` in the query. */
  app.get('/api/v1/users/:id/avatar', { preHandler: authenticateFn }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = ctx.users.byId(id);
    if (!row) throw notFound('user not found');
    const rel = (row.avatar_path ?? '').trim();
    if (!rel) throw notFound('no avatar', 'NO_AVATAR');
    const abs = resolveInside(ctx.config.dataDir, assertSafeRel(rel));
    if (!existsSync(abs)) throw notFound('avatar missing', 'NO_AVATAR');
    reply.header('content-type', imageContentType(abs));
    reply.header('cache-control', 'private, max-age=86400');
    return reply.send(createReadStream(abs));
  });

  app.post('/api/v1/auth/password', { preHandler: authenticateFn }, async (request) => {
    const user = currentUser(request);
    const body = (request.body ?? {}) as { currentPassword?: string; newPassword?: string };
    if (!body.currentPassword || !body.newPassword) throw badRequest('currentPassword and newPassword are required');
    await ctx.users.changePassword(user.id, body.currentPassword, body.newPassword);
    return { ok: true };
  });

  app.get('/api/v1/instance', async () => {
    // Advertised so a client can tell a fresh instance from a claimed one
    // without attempting registration.
    return {
      name: 'reader',
      apiVersion: 1,
      registrationOpen: ctx.users.canRegisterPublicly(),
      registrationMode: ctx.users.count() === 0 ? 'open' : registration.mode(),
      invitationRequired: ctx.users.count() > 0 && registration.mode() === 'invite',
      userCount: ctx.users.count(),
    };
  });
}

async function readAvatarBytes(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > AVATAR_MAX_BYTES) {
      stream.destroy();
      throw badRequest('头像图片不能超过 10MB', 'AVATAR_TOO_LARGE');
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}
