import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:http';
import {Db} from '../src/db/index.ts';
import type {AppConfig} from '../src/config/index.ts';
import type {AppContext} from '../src/http/context.ts';
import {BusinessSettings,BusinessSettingsReader} from '../src/services/business-settings.ts';
import {UserService} from '../src/services/users.ts';
import {buildApp} from '../src/http/app.ts';
import {signAccessToken} from '../src/services/tokens.ts';
import {configuredProviders} from '../src/media/configured-providers.ts';
import {MediaReadDatabase} from '../src/media/read-database.ts';
import {RegistrationService} from '../src/services/registration.ts';

function config(root:string):AppConfig{return {booksDir:root,dataDir:root,host:'127.0.0.1',port:0,jwtSecret:'settings-test-secret-at-least-16',accessTokenTtl:604800,refreshTokenTtl:31536000,scanInterval:1800,watchInterval:60,logLevel:'silent',publicUrl:'',corsOrigins:[],webDir:join(root,'web')};}

test('settings migrate once, redact secrets, reject stale edits and are visible to read-only media connections',async t=>{
  const root=await mkdtemp(join(tmpdir(),'business-settings-')),path=join(root,'reader.db');
  t.after(()=>rm(root,{recursive:true,force:true}));
  const old=process.env.MEDIA_TMDB_TOKEN;process.env.MEDIA_TMDB_TOKEN='legacy-secret';
  t.after(()=>{if(old===undefined)delete process.env.MEDIA_TMDB_TOKEN;else process.env.MEDIA_TMDB_TOKEN=old;});
  const db=new Db(path),settings=new BusinessSettings(db,config(root)),view=settings.view('tmdb');
  assert.equal(settings.read('tmdb').token,'legacy-secret');assert.equal(view.secrets.token,true);
  assert.ok(!JSON.stringify(view).includes('legacy-secret'));assert.equal(view.values.token,undefined);
  const remote=new MediaReadDatabase(path),reader=new BusinessSettingsReader(remote),providers=configuredProviders(reader);
  const running=providers();assert.equal(running[0]!.configured,true);
  settings.save('tmdb',{enabled:false,token:'',apiKey:''},view.revision);
  assert.equal(providers()[0]!.configured,false);assert.equal(running[0]!.configured,true,'existing job keeps its provider snapshot');
  assert.throws(()=>settings.save('tmdb',{enabled:true},view.revision),{code:'SETTINGS_CONFLICT'});
  assert.throws(()=>settings.save('scanning',{files:999},settings.view('scanning').revision),{statusCode:400});
  assert.equal(settings.read('scanning').interval,60);
  assert.equal(settings.read('playback').mode,'auto');
  assert.throws(()=>settings.save('playback',{mode:'invalid'},settings.view('playback').revision),{statusCode:400});
  settings.save('playback',{mode:'proxy'},settings.view('playback').revision);
  assert.equal(reader.read('playback').mode,'proxy');
  remote.close();db.close();
  const reopened=new Db(path);try{const next=new BusinessSettings(reopened,config(root));assert.equal(next.read('tmdb').token,'');assert.equal(next.read('tmdb').enabled,false);}finally{reopened.close();}
});

test('admin API changes HTTP speech and OPDS live, preserves secrets, and blocks member writes',async t=>{
  const root=await mkdtemp(join(tmpdir(),'business-api-')),db=new Db(':memory:'),cfg=config(root);
  let authHeader='',calls=0;
  const upstream=createServer((req,res)=>{
    authHeader=String(req.headers.authorization||'');calls++;
    if(req.url?.startsWith('/voices')){res.setHeader('content-type','application/json');res.end('[{"id":"zh","name":"中文"}]');}
    else{res.setHeader('content-type','audio/mpeg');res.end('audio');}
  });
  await new Promise<void>(resolve=>upstream.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+(upstream.address() as {port:number}).port;
  const ctx={config:cfg,db,users:new UserService(db,cfg)} as AppContext;
  for(const [id,role] of [['admin','admin'],['member','member']])db.run('INSERT INTO users(id,username,display_name,password_hash,role,created_at,updated_at) VALUES(?,?,?,?,?,0,0)',id!,id!,id!,'unused',role!);
  const app=buildApp(ctx);await app.ready();
  t.after(async()=>{await app.close();db.close();upstream.closeAllConnections();await new Promise<void>(resolve=>upstream.close(()=>resolve()));await rm(root,{recursive:true,force:true});});
  const admin={authorization:'Bearer '+signAccessToken(cfg,{id:'admin',role:'admin'}).token},member={authorization:'Bearer '+signAccessToken(cfg,{id:'member',role:'member'}).token};
  assert.equal((await app.inject({url:'/api/v1/admin/settings'})).statusCode,401);
  assert.equal((await app.inject({url:'/api/v1/admin/settings',headers:member})).statusCode,403);
  assert.equal((await app.inject({method:'PATCH',url:'/api/v1/admin/settings/tts',headers:member,payload:{}})).statusCode,403);
  const save=async(group:string,values:object,headers:Record<string,string>=admin)=>app.inject({method:'PATCH',url:'/api/v1/admin/settings/'+group,headers,payload:{values,revision:ctx.settings!.view(group as 'tts').revision}});
  const saved=await save('tts',{enabled:true,url:origin+'/tts',voicesUrl:origin+'/voices',token:'private-token',cacheMaxBytes:0});
  assert.equal(saved.statusCode,200,saved.body);assert.ok(!saved.body.includes('private-token'));
  const voices=await app.inject({url:'/api/v1/tts/voices',headers:admin});assert.equal(voices.json().http,true);assert.equal(voices.json().voices[0].id,'zh');
  const audio=await app.inject({method:'POST',url:'/api/v1/tts/test',headers:admin,payload:{}});assert.equal(audio.statusCode,200,audio.body);assert.equal(authHeader,'Bearer private-token');
  const count=calls;await app.inject({method:'POST',url:'/api/v1/tts/test',headers:admin,payload:{}});assert.ok(calls>count,'cache disabled really bypasses existing audio');
  await save('tts',{timeoutMs:1000});assert.equal(ctx.settings!.read('tts').token,'private-token');
  assert.equal((await save('tts',{enabled:false,token:''})).statusCode,200);
  assert.equal((await app.inject({url:'/api/v1/tts/voices',headers:admin})).json().http,false);
  assert.equal((await save('access',{publicUrl:'https://books.example'})).statusCode,200);
  assert.equal((await app.inject({url:'/api/v1/opds/credentials',headers:admin})).json().catalogUrl,'https://books.example/opds');
  const locked=await save('access',{corsOrigins:'https://other.example'},{...admin,origin:'https://books.example'});
  assert.equal(locked.statusCode,400);assert.equal(ctx.config.corsOrigins.length,0);
});

test('AI capabilities tell a reader whether 章节总结 is available, without the configuration',async t=>{
  const root=await mkdtemp(join(tmpdir(),'ai-capabilities-')),db=new Db(':memory:'),cfg=config(root);
  const ctx={config:cfg,db,users:new UserService(db,cfg)} as AppContext;
  for(const [id,role] of [['admin','admin'],['member','member']])db.run('INSERT INTO users(id,username,display_name,password_hash,role,created_at,updated_at) VALUES(?,?,?,?,?,0,0)',id!,id!,id!,'unused',role!);
  const app=buildApp(ctx);await app.ready();
  t.after(async()=>{await app.close();db.close();await rm(root,{recursive:true,force:true});});
  const admin={authorization:'Bearer '+signAccessToken(cfg,{id:'admin',role:'admin'}).token},member={authorization:'Bearer '+signAccessToken(cfg,{id:'member',role:'member'}).token};
  assert.equal((await app.inject({url:'/api/v1/ai/capabilities'})).statusCode,401);
  assert.deepEqual((await app.inject({url:'/api/v1/ai/capabilities',headers:member})).json(),{summary:false,scan:false});
  const save=(values:object)=>app.inject({method:'PATCH',url:'/api/v1/admin/settings/ai',headers:admin,payload:{values,revision:ctx.settings!.view('ai').revision}});
  const on=await save({enabled:true,baseUrl:'https://ai.example/v1',apiKey:'secret-key',model:'m'});assert.equal(on.statusCode,200,on.body);
  assert.deepEqual((await app.inject({url:'/api/v1/ai/capabilities',headers:member})).json(),{summary:false,scan:false},'AI on, 总结 and 扫描 still off');
  assert.equal((await save({summaryEnabled:true})).statusCode,200);
  const ready=await app.inject({url:'/api/v1/ai/capabilities',headers:member});
  assert.deepEqual(ready.json(),{summary:true,scan:false});
  assert.equal((await save({scanEnabled:true})).statusCode,200);
  assert.deepEqual((await app.inject({url:'/api/v1/ai/capabilities',headers:member})).json(),{summary:true,scan:true});
  assert.equal((await save({enabled:false})).statusCode,200);
  assert.deepEqual((await app.inject({url:'/api/v1/ai/capabilities',headers:member})).json(),{summary:false,scan:false},'the master switch turns both off');assert.ok(!ready.body.includes('secret-key'));
});

test('site name and icon are public, and the stored path stays out of the form',async t=>{
  const root=await mkdtemp(join(tmpdir(),'site-brand-')),db=new Db(':memory:'),cfg=config(root);
  const ctx={config:cfg,db,users:new UserService(db,cfg)} as AppContext;
  for(const [id,role] of [['admin','admin'],['member','member']])db.run('INSERT INTO users(id,username,display_name,password_hash,role,created_at,updated_at) VALUES(?,?,?,?,?,0,0)',id!,id!,id!,'unused',role!);
  const app=buildApp(ctx);await app.ready();
  t.after(async()=>{await app.close();db.close();await rm(root,{recursive:true,force:true});});
  const admin={authorization:'Bearer '+signAccessToken(cfg,{id:'admin',role:'admin'}).token},member={authorization:'Bearer '+signAccessToken(cfg,{id:'member',role:'member'}).token};
  assert.equal((await app.inject({url:'/api/v1/instance'})).json().name,'reader');
  assert.equal((await app.inject({url:'/api/v1/instance'})).json().iconUrl,null);
  assert.equal((await app.inject({url:'/api/v1/site/icon'})).statusCode,404);
  const named=await app.inject({method:'PATCH',url:'/api/v1/admin/settings/site',headers:admin,payload:{values:{name:'书房'},revision:ctx.settings!.view('site').revision}});
  assert.equal(named.statusCode,200,named.body);
  assert.equal(named.json().values.name,'书房');
  assert.equal(named.json().iconUrl,null);
  assert.equal(named.json().values.icon,undefined);
  assert.equal((await app.inject({url:'/api/v1/instance'})).json().name,'书房');
  assert.equal((await app.inject({method:'PATCH',url:'/api/v1/admin/settings/site',headers:admin,payload:{values:{name:'a'.repeat(41)},revision:ctx.settings!.view('site').revision}})).statusCode,400);
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
  const boundary='----reader-site-icon';
  const part=(filename:string,type:string,bytes:Buffer)=>Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`),
    bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  assert.equal((await app.inject({method:'POST',url:'/api/v1/admin/settings/site/icon',headers:{...member,'content-type':`multipart/form-data; boundary=${boundary}`},payload:part('a.png','image/png',png)})).statusCode,403);
  const uploaded=await app.inject({method:'POST',url:'/api/v1/admin/settings/site/icon',headers:{...admin,'content-type':`multipart/form-data; boundary=${boundary}`},payload:part('a.png','image/png',png)});
  assert.equal(uploaded.statusCode,200,uploaded.body);
  assert.equal(uploaded.json().values.name,'书房');
  assert.match(uploaded.json().iconUrl,/^\/api\/v1\/site\/icon\?v=/);
  assert.equal(uploaded.json().values.icon,undefined);
  assert.equal(JSON.stringify(uploaded.json()).includes('site/icon.png'),false);
  assert.equal((await readFile(join(root,'site','icon.png'))).equals(png),true);
  const icon=await app.inject({url:'/api/v1/site/icon'});
  assert.equal(icon.statusCode,200);
  assert.equal(icon.headers['content-type'],'image/png');
  assert.equal(icon.rawPayload.equals(png),true);
  assert.equal((await app.inject({url:'/api/v1/instance'})).json().iconUrl,uploaded.json().iconUrl);
  const rejected=await app.inject({method:'POST',url:'/api/v1/admin/settings/site/icon',headers:{...admin,'content-type':`multipart/form-data; boundary=${boundary}`},payload:part('notes.txt','text/plain',Buffer.from('not a picture'))});
  assert.equal(rejected.statusCode,400);
  const kept=await app.inject({method:'PATCH',url:'/api/v1/admin/settings/site',headers:admin,payload:{values:{name:'新书房'},revision:ctx.settings!.view('site').revision}});
  assert.equal(kept.statusCode,200,kept.body);
  assert.equal(kept.json().values.name,'新书房');
  assert.ok(kept.json().iconUrl);
  const cleared=await app.inject({method:'DELETE',url:'/api/v1/admin/settings/site/icon',headers:admin});
  assert.equal(cleared.statusCode,200,cleared.body);
  assert.equal(cleared.json().iconUrl,null);
  assert.equal(cleared.json().values.name,'新书房');
  assert.equal((await app.inject({url:'/api/v1/site/icon'})).statusCode,404);
  assert.equal((await app.inject({url:'/api/v1/instance'})).json().name,'新书房');
});

test('an unset system name stored as 阅读 becomes reader, and a chosen name stays',()=>{
  const db=new Db(':memory:');
  db.run('INSERT INTO business_settings(name,value,revision) VALUES(?,?,?)','site',JSON.stringify({name:'阅读',icon:'site/icon.png'}),4);
  const root=join(tmpdir(),'site-name-default');
  const settings=new BusinessSettings(db,config(root));
  try{
    assert.equal(settings.read('site').name,'reader');
    assert.equal(settings.read('site').icon,'site/icon.png');
    assert.equal(settings.view('site').values.name,'reader');
    settings.save('site',{name:'书房'},settings.view('site').revision);
    assert.equal(new BusinessSettings(db,config(root)).read('site').name,'书房');
  }finally{db.close();}
});

test('registration stores legacy default once instead of falling back after later env changes',()=>{
  const db=new Db(':memory:'),old=process.env.ALLOW_REGISTRATION;
  try{process.env.ALLOW_REGISTRATION='true';const service=new RegistrationService(db);assert.equal(service.mode(),'open');service.setMode('closed');assert.equal(new RegistrationService(db).mode(),'closed');}
  finally{db.close();if(old===undefined)delete process.env.ALLOW_REGISTRATION;else process.env.ALLOW_REGISTRATION=old;}
});
