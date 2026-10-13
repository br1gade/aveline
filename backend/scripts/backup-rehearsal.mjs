import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';

const execute = promisify(execFile);
const docker = (...args) => execute('docker', args, { timeout: 120000, maxBuffer: 2 * 1024 * 1024 });
const scope = `aveline-recovery-${process.pid}`;
const root = await mkdtemp(join(tmpdir(), 'aveline-recovery-'));
const apiImage = process.env.PILOT_REHEARSAL_IMAGE ?? 'aveline-api:pilot-readiness';
const backupImage = process.env.BACKUP_REHEARSAL_IMAGE ?? 'aveline-backup:pilot-readiness';
const scripts = new URL('./', import.meta.url).pathname;
const password = randomBytes(24).toString('hex');
const resticPassword = randomBytes(32).toString('base64');
const containers = [];
let wasNetworkCreated = false;
let stage = 'create disposable stores';
async function start(name, image, args) {
  const id = `${scope}-${name}`;
  containers.push(id);
  await docker('run', '-d', '--name', id, '--network', scope, ...args, image);
  return id;
}
const databaseUrl = (name) => `postgresql://aveline:${password}@${scope}-${name}:5432/aveline_recovery_test?schema=public`;
async function ready(name, command) {
  for (let attempt = 0; attempt < 60; attempt++) {
    try { return await docker('exec', name, ...command); } catch { await new Promise((resolve) => setTimeout(resolve, 250)); }
  }
  throw new Error('Disposable store did not become ready');
}
const sourceConfig = `metadata_dir="/var/lib/garage/meta"\ndata_dir="/var/lib/garage/data"\ndb_engine="sqlite"\nreplication_factor=1\nrpc_bind_addr="[::]:3901"\nrpc_public_addr="${scope}-garage:3901"\nrpc_secret="${randomBytes(32).toString('hex')}"\n[s3_api]\ns3_region="garage"\napi_bind_addr="[::]:3900"\n[s3_web]\nbind_addr="[::]:3902"\nroot_domain=".web.garage.localhost"\nindex="index.html"\n`;
try {
  for (const folder of ['data', 'meta', 'restored-data', 'restored-meta', 'backups', 'repository', 'config', 'recovery']) {
    await mkdir(join(root, folder));
  }
  await writeFile(join(root, 'config', 'garage.toml'), sourceConfig, { mode: 0o600 });
  await docker('network', 'create', scope);
  wasNetworkCreated = true;
  for (const name of ['postgres', 'restored-postgres']) {
    await start(name, 'postgres:16.15-alpine', ['-e', 'POSTGRES_USER=aveline', '-e', `POSTGRES_PASSWORD=${password}`, '-e', 'POSTGRES_DB=aveline_recovery_test']);
    await ready(`${scope}-${name}`, ['pg_isready', '-U', 'aveline']);
  }
  const garage = await start('garage', 'dxflrs/garage:v2.1.0', [
    '-v', `${root}/config/garage.toml:/etc/garage.toml:ro`, '-v', `${root}/data:/var/lib/garage/data`, '-v', `${root}/meta:/var/lib/garage/meta`,
  ]);
  await ready(garage, ['/garage', 'status']);
  const node = (await docker('exec', garage, '/garage', 'node', 'id')).stdout.trim().split('@')[0];
  await docker('exec', garage, '/garage', 'layout', 'assign', '-z', 'rehearsal', '-c', '1G', node);
  await docker('exec', garage, '/garage', 'layout', 'apply', '--version', '1');
  await docker('exec', garage, '/garage', 'bucket', 'create', 'rehearsal-media');
  await docker('exec', garage, '/garage', 'key', 'create', 'rehearsal-key');
  await docker('exec', garage, '/garage', 'bucket', 'allow', '--read', '--write', '--owner', 'rehearsal-media', '--key', 'rehearsal-key');
  const keyInfo = (await docker('exec', garage, '/garage', 'key', 'info', 'rehearsal-key', '--show-secret')).stdout;
  const accessKey = /Key ID:\s*(\S+)/.exec(keyInfo)[1];
  const secretKey = /Secret key:\s*(\S+)/.exec(keyInfo)[1];
  stage = 'migrate and seed domain/media references';
  await docker('run', '--rm', '--network', scope, '-e', `DATABASE_URL=${databaseUrl('postgres')}`, apiImage, 'npx', 'prisma', 'migrate', 'deploy');
  const seed = `const {PrismaClient}=require('@prisma/client');const {S3Client,PutObjectCommand}=require('@aws-sdk/client-s3');(async()=>{const p=new PrismaClient();const c=new S3Client({endpoint:process.env.ENDPOINT,region:'garage',forcePathStyle:true,credentials:{accessKeyId:process.env.ACCESS_KEY,secretAccessKey:process.env.SECRET_KEY}});await c.send(new PutObjectCommand({Bucket:'rehearsal-media',Key:'photo-original',Body:'synthetic original'}));await c.send(new PutObjectCommand({Bucket:'rehearsal-media',Key:'photo-variant',Body:'synthetic variant'}));const o=await p.organization.create({data:{name:'Recovery fixture',kind:'HOST'}});const e=await p.event.create({data:{organizationId:o.id,type:'WEDDING',title:'Recovery',hostsLabel:'A & B',startsAt:new Date()}});const h=await p.household.create({data:{eventId:e.id,name:'Fixture',seatsAllotted:1}});await p.guest.create({data:{eventId:e.id,householdId:h.id,firstName:'Անի',token:'synthetic-recovery-token'}});await p.mediaAsset.create({data:{eventId:e.id,kind:'PHOTO',url:'https://media.example.test/photo-original',variants:[{url:'https://media.example.test/photo-variant',width:480}]}});await p.$disconnect()})().catch(()=>process.exit(1));`;
  await docker('run', '--rm', '--network', scope, '-e', `DATABASE_URL=${databaseUrl('postgres')}`, '-e', `ENDPOINT=http://${garage}:3900`, '-e', `ACCESS_KEY=${accessKey}`, '-e', `SECRET_KEY=${secretKey}`, apiImage, 'node', '-e', seed);
  await docker('stop', garage);
  stage = 'capture stable database and Garage';
  const backupArgs = ['--rm', '--network', scope, '-v', `${scripts}:/scripts:ro`, '-v', `${root}/backups:/backups`, '-v', `${root}/data:/garage-data:ro`, '-v', `${root}/meta:/garage-meta:ro`, '-v', `${root}/config:/runtime-config:ro`, '-e', 'POSTGRES_USER=aveline', '-e', `POSTGRES_PASSWORD=${password}`, '-e', 'POSTGRES_DB=aveline_recovery_test', '-e', `POSTGRES_HOST=${scope}-postgres`, '-e', 'BACKUP_QUIESCED=true', '-e', 'BACKUP_RUN_ID=drill'];
  await docker('run', ...backupArgs, backupImage, '/bin/sh', '/scripts/backup.sh');
  stage = 'initialize and verify encrypted rehearsal repository';
  const repositoryArgs = ['--rm', '-v', `${scripts}:/scripts:ro`, '-v', `${root}/backups:/backups`, '-v', `${root}/repository:/repository`, '-v', `${root}/recovery:/recovery`, '-e', 'NODE_ENV=test', '-e', 'BACKUP_ALLOW_LOCAL_REPOSITORY=true', '-e', 'RESTIC_REPOSITORY=/repository', '-e', `RESTIC_PASSWORD=${resticPassword}`];
  await docker('run', ...repositoryArgs, backupImage, 'restic', 'init');
  stage = 'upload and read back encrypted rehearsal repository';
  await docker('run', ...repositoryArgs, backupImage, '/bin/sh', '/scripts/backup-upload.sh', 'drill');
  await assert.rejects(readFile(join(root, 'backups', 'offhost-success.json')), /ENOENT/);
  stage = 'download encrypted recovery set';
  await docker('run', ...repositoryArgs, backupImage, '/bin/sh', '/scripts/fetch-recovery.sh', 'drill', '/recovery/download');
  const restored = join(root, 'recovery', 'download', 'backups', 'drill');
  stage = 'restore paired database and media';
  await docker('run', '--rm', '--network', scope, '-v', `${scripts}:/scripts:ro`, '-v', `${restored}:/recovery-set:ro`, '-v', `${root}/restored-data:/garage-data`, '-v', `${root}/restored-meta:/garage-meta`, '-e', 'NODE_ENV=test', '-e', 'RESTORE_DISPOSABLE=true', '-e', 'RESTORE_QUIESCED=true', '-e', 'POSTGRES_USER=aveline', '-e', `POSTGRES_PASSWORD=${password}`, '-e', 'POSTGRES_DB=aveline_recovery_test', '-e', `POSTGRES_HOST=${scope}-restored-postgres`, backupImage, '/bin/sh', '/scripts/restore-recovery.sh', '/recovery-set');
  await writeFile(join(root, 'config', 'restored.toml'), sourceConfig.replace(`${scope}-garage:3901`, `${scope}-restored-garage:3901`), { mode: 0o600 });
  const restoredGarage = await start('restored-garage', 'dxflrs/garage:v2.1.0', ['-v', `${root}/config/restored.toml:/etc/garage.toml:ro`, '-v', `${root}/restored-data:/var/lib/garage/data`, '-v', `${root}/restored-meta:/var/lib/garage/meta`]);
  await ready(restoredGarage, ['/garage', 'status']);
  stage = 'verify restored guest credential and object bytes';
  const verify = `const{PrismaClient}=require('@prisma/client');const{S3Client,GetObjectCommand}=require('@aws-sdk/client-s3');(async()=>{const p=new PrismaClient();if(await p.guest.count({where:{token:'synthetic-recovery-token'}})!==1)throw Error('guest');if(await p.mediaAsset.count()!==1)throw Error('asset');const c=new S3Client({endpoint:process.env.ENDPOINT,region:'garage',forcePathStyle:true,credentials:{accessKeyId:process.env.ACCESS_KEY,secretAccessKey:process.env.SECRET_KEY}});for(const[key,value]of[['photo-original','synthetic original'],['photo-variant','synthetic variant']]){const r=await c.send(new GetObjectCommand({Bucket:'rehearsal-media',Key:key}));if(await r.Body.transformToString()!==value)throw Error('object')}await p.$disconnect()})().catch(()=>process.exit(1));`;
  await docker('run', '--rm', '--network', scope, '-e', `DATABASE_URL=${databaseUrl('restored-postgres')}`, '-e', `ENDPOINT=http://${restoredGarage}:3900`, '-e', `ACCESS_KEY=${accessKey}`, '-e', `SECRET_KEY=${secretKey}`, apiImage, 'node', '-e', verify);
  console.log('Recovery drill passed: encrypted repository -> fresh Postgres/Garage, guest credential, media original and variant intact.');
  console.log('Repository was isolated on this machine; a real off-host destination remains to be configured and verified.');
} catch (error) {
  console.error(`Recovery drill failed at: ${stage}. Temporary secrets and child command arguments are withheld.`);
  if (typeof error.stderr === 'string') console.error(error.stderr.slice(-1800).replace(/[A-Za-z0-9+/_=-]{24,}/g, '[redacted]'));
  process.exitCode = 1;
} finally {
  await Promise.all(containers.map((name) => docker('rm', '-f', name).catch(() => undefined)));
  if (wasNetworkCreated) await docker('network', 'rm', scope);
  // Capture/restore writes are root-owned and private. Give only this caller
  // ownership of this drill's generated directory before deleting it.
  await docker('run', '--rm', '-v', `${root}:/work`, backupImage, 'chown', '-R', `${process.getuid()}:${process.getgid()}`, '/work');
  await rm(root, { recursive: true, force: true });
}
