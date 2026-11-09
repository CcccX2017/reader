import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Db } from '../src/db/index.ts';
import { buildApp } from '../src/http/app.ts';
import { UserService } from '../src/services/users.ts';
import { RegistrationService } from '../src/services/registration.ts';
import type { AppContext } from '../src/http/context.ts';
import type { AppConfig } from '../src/config/index.ts';

test('admin users, persisted registration policy, bounded invites and immediate session revocation',async t=>{
  const root=await mkdtemp(join(tmpdir(),'reader-users-'));await mkdir(join(root,'books'));await mkdir(join(root,'data'));
  const config={booksDir:join(root,'books'),dataDir:join(root,'data'),jwtSecret:'isolated-admin-test-secret',accessTokenTtl:604800,refreshTokenTtl:31536000,logLevel:'silent',corsOrigins:[],webDir:'',publicUrl:''} as unknown as AppConfig;
  const db=new Db(join(root,'data','reader.db')),users=new UserService(db,config);
  const app=buildApp({db,config,users} as AppContext);
  t.after(async()=>{await app.close();db.close();await rm(root,{recursive:true,force:true});});
  let registrationClient=0;
  const register=(username:string,inviteCode?:string)=>app.inject({method:'POST',url:'/api/v1/auth/register',remoteAddress:`192.0.2.${++registrationClient}`,payload:{username,password:'password123',inviteCode}});
  const first=await register('owner');assert.equal(first.statusCode,201);
  const owner=first.json().session,headers={authorization:'Bearer '+owner.accessToken};
  const setting=(mode:string)=>app.inject({method:'PATCH',url:'/api/v1/admin/registration',headers,payload:{mode}});
  assert.equal((await setting('closed')).statusCode,200);assert.equal((await register('blocked')).statusCode,400);
  assert.equal((await setting('open')).statusCode,200);assert.equal((await register('public-member')).statusCode,201);
  assert.equal((await setting('invite')).statusCode,200);
  assert.equal(new RegistrationService(db).mode(),'invite');
  const reopened=new Db(join(root,'data','reader.db'));assert.equal(new RegistrationService(reopened).mode(),'invite');reopened.close();
  const instance=(await app.inject({url:'/api/v1/instance'})).json();assert.equal(instance.invitationRequired,true);assert.equal(instance.registrationOpen,true);
  assert.equal((await register('missing-invite')).json().error.code,'INVITE_REQUIRED');
  const minted=await app.inject({method:'POST',url:'/api/v1/admin/invites',headers,payload:{label:'single',days:1,maxUses:1}});
  assert.equal(minted.statusCode,201);const {code,invite}=minted.json();
  assert.equal((await register('owner',code)).statusCode,409);
  assert.equal(new RegistrationService(db).invites()[0]!.usedCount,0);
  const raced=await Promise.all([register('invite-one',code),register('invite-two',code)]);
  assert.deepEqual(raced.map(r=>r.statusCode).sort(),[201,400]);
  const member=raced.find(r=>r.statusCode===201)!.json().session,memberHeaders={authorization:'Bearer '+member.accessToken};
  assert.equal(member.user.role,'member');
  const invites=(await app.inject({url:'/api/v1/admin/registration',headers})).json();
  assert.equal(invites.invites.find((i:{id:string})=>i.id===invite.id).usedCount,1);
  assert.ok(!JSON.stringify(invites).includes(code));assert.ok(!JSON.stringify(invites).includes('code_hash'));
  for (const [method,url,payload] of [['GET','/api/v1/admin/users',undefined],['POST','/api/v1/admin/users',{username:'attacker',password:'password123'}],['PATCH','/api/v1/admin/registration',{mode:'open'}],['POST','/api/v1/admin/invites',{}],['POST',`/api/v1/admin/users/${owner.user.id}/password`,{password:'password456'}]] as const) {
    const result=await app.inject({method,url,headers:memberHeaders,...(payload?{payload}:{})});assert.equal(result.statusCode,403);
  }
  assert.equal((await app.inject({method:'PATCH',url:`/api/v1/admin/users/${owner.user.id}`,headers,payload:{role:'member'}})).json().error.code,'SELF_LOCKOUT');
  assert.equal((await app.inject({method:'PATCH',url:`/api/v1/admin/users/${member.user.id}`,headers,payload:{disabled:'false'}})).statusCode,400);
  const reset=await app.inject({method:'POST',url:`/api/v1/admin/users/${member.user.id}/password`,headers,payload:{password:'newpassword123'}});assert.equal(reset.statusCode,200);
  assert.equal((await app.inject({url:'/api/v1/auth/me',headers:memberHeaders})).statusCode,401);
  assert.equal((await app.inject({method:'POST',url:'/api/v1/auth/refresh',payload:{refreshToken:member.refreshToken}})).statusCode,401);
  const login=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{username:member.user.username,password:'newpassword123'}});assert.equal(login.statusCode,200);
  const newHeaders={authorization:'Bearer '+login.json().accessToken};
  assert.equal((await app.inject({method:'PATCH',url:`/api/v1/admin/users/${member.user.id}`,headers,payload:{disabled:true}})).statusCode,200);
  assert.equal((await app.inject({url:'/api/v1/auth/me',headers:newHeaders})).statusCode,403);
  assert.equal((await app.inject({method:'PATCH',url:`/api/v1/admin/users/${member.user.id}`,headers,payload:{disabled:false}})).statusCode,200);
  assert.equal((await app.inject({url:'/api/v1/auth/me',headers:newHeaders})).statusCode,401);
  const disabled=new RegistrationService(db).create('disabled',1,1);new RegistrationService(db).disable(disabled.invite.id);
  assert.equal((await register('disabled-invite',disabled.code)).json().error.code,'INVITE_INVALID');
  const expired=new RegistrationService(db).create('expired',1,1);db.run('UPDATE registration_invites SET expires_at=0 WHERE id=?',expired.invite.id);
  assert.equal((await register('expired-invite',expired.code)).json().error.code,'INVITE_INVALID');
});

test('a signed-in user can change their display name without signing out', async t => {
  const root = await mkdtemp(join(tmpdir(), 'reader-display-name-'));
  await mkdir(join(root, 'books'));
  await mkdir(join(root, 'data'));
  const config = { booksDir: join(root, 'books'), dataDir: join(root, 'data'), jwtSecret: 'display-name-test-secret', accessTokenTtl: 604800, refreshTokenTtl: 31536000, logLevel: 'silent', corsOrigins: [], webDir: '', publicUrl: '' } as unknown as AppConfig;
  const db = new Db(join(root, 'data', 'reader.db'));
  const users = new UserService(db, config);
  const app = buildApp({ db, config, users } as AppContext);
  t.after(async () => { await app.close(); db.close(); await rm(root, { recursive: true, force: true }); });
  const registered = await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { username: 'lin', password: 'password123' } });
  assert.equal(registered.statusCode, 201);
  const headers = { authorization: 'Bearer ' + registered.json().session.accessToken };
  const renamed = await app.inject({ method: 'PATCH', url: '/api/v1/auth/me', headers, payload: { displayName: '林间' } });
  assert.equal(renamed.statusCode, 200, renamed.body);
  assert.equal(renamed.json().user.displayName, '林间');
  assert.equal((await app.inject({ url: '/api/v1/auth/me', headers })).json().user.displayName, '林间');
  // Empty clears back to the username; the session stays valid.
  const cleared = await app.inject({ method: 'PATCH', url: '/api/v1/auth/me', headers, payload: { displayName: '  ' } });
  assert.equal(cleared.statusCode, 200);
  assert.equal(cleared.json().user.displayName, 'lin');
  assert.equal((await app.inject({ method: 'PATCH', url: '/api/v1/auth/me', headers, payload: { displayName: 'x'.repeat(101) } })).statusCode, 400);
});

test('a signed-in user can replace their avatar; a new upload overwrites the old one', async t => {
  const root = await mkdtemp(join(tmpdir(), 'reader-avatar-'));
  await mkdir(join(root, 'books'));
  await mkdir(join(root, 'data'));
  const config = { booksDir: join(root, 'books'), dataDir: join(root, 'data'), jwtSecret: 'avatar-test-secret', accessTokenTtl: 604800, refreshTokenTtl: 31536000, logLevel: 'silent', corsOrigins: [], webDir: '', publicUrl: '' } as unknown as AppConfig;
  const db = new Db(join(root, 'data', 'reader.db'));
  const users = new UserService(db, config);
  const app = buildApp({ db, config, users } as AppContext);
  t.after(async () => { await app.close(); db.close(); await rm(root, { recursive: true, force: true }); });

  const registered = await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { username: 'lin', password: 'password123' } });
  assert.equal(registered.statusCode, 201);
  const userId = registered.json().user.id as string;
  const headers = { authorization: 'Bearer ' + registered.json().session.accessToken };
  assert.equal(registered.json().user.avatarUrl, null);

  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const boundary = '----reader-avatar';
  const part = (name: string, type: string, bytes: Buffer) => Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${type}\r\n\r\n`),
    bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const uploaded = await app.inject({
    method: 'POST', url: '/api/v1/auth/avatar',
    headers: { ...headers, 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: part('a.png', 'image/png', png),
  });
  assert.equal(uploaded.statusCode, 200, uploaded.body);
  const avatarUrl = uploaded.json().user.avatarUrl as string;
  assert.ok(avatarUrl.startsWith(`/api/v1/users/${userId}/avatar?v=`));
  assert.equal((await readFile(join(root, 'data', 'avatars', `${userId}.png`))).equals(png), true);

  const fetched = await app.inject({ method: 'GET', url: avatarUrl.split('?')[0]!, headers });
  assert.equal(fetched.statusCode, 200);
  assert.equal(fetched.headers['content-type'], 'image/png');
  assert.equal(fetched.rawPayload.equals(png), true);

  // JPEG overwrites the previous PNG file.
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const replaced = await app.inject({
    method: 'POST', url: '/api/v1/auth/avatar',
    headers: { ...headers, 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: part('b.jpg', 'image/jpeg', jpeg),
  });
  assert.equal(replaced.statusCode, 200, replaced.body);
  assert.equal(await readFile(join(root, 'data', 'avatars', `${userId}.png`)).then(() => true, () => false), false);
  assert.equal((await readFile(join(root, 'data', 'avatars', `${userId}.jpg`))).equals(jpeg), true);

  const rejected = await app.inject({
    method: 'POST', url: '/api/v1/auth/avatar',
    headers: { ...headers, 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: part('notes.txt', 'text/plain', Buffer.from('not a picture')),
  });
  assert.equal(rejected.statusCode, 400);

  const cleared = await app.inject({ method: 'DELETE', url: '/api/v1/auth/avatar', headers });
  assert.equal(cleared.statusCode, 200);
  assert.equal(cleared.json().user.avatarUrl, null);
  assert.equal((await app.inject({ method: 'GET', url: `/api/v1/users/${userId}/avatar`, headers })).statusCode, 404);
});
