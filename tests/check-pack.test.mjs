// Copyright (c) 2026 阿杜 (Adu). MIT; see ../LICENSE.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { checkPack, inspectPng } from '../scripts/check-pack.mjs';

const example=fileURLToPath(new URL('../examples/ahe/',import.meta.url));
async function sandbox(fn) {
  const dir=await mkdtemp(path.join(tmpdir(),'adu-ip-test-'));
  try { await cp(example,dir,{recursive:true}); await fn(dir); }
  finally { await rm(dir,{recursive:true,force:true}); }
}
async function changeManifest(dir,fn) {
  const p=path.join(dir,'character.json'), data=JSON.parse(await readFile(p,'utf8'));
  fn(data); await writeFile(p,JSON.stringify(data));
}
// Tiny RGBA fixtures exercise false transparency claims, independently of
// model-generated examples. CRCs are calculated for actual valid PNG chunks.
function crc32(buf) {
  let crc=0xffffffff;
  for (const b of buf) { crc^=b; for(let i=0;i<8;i++) crc=(crc>>>1)^((crc&1)?0xedb88320:0); }
  return (crc^0xffffffff)>>>0;
}
function png(alpha) {
  function chunk(kind,data) {
    const body=Buffer.concat([Buffer.from(kind),data]), out=Buffer.alloc(data.length+12);
    out.writeUInt32BE(data.length,0); body.copy(out,4); out.writeUInt32BE(crc32(body),8+data.length); return out;
  }
  const header=Buffer.alloc(13);header.writeUInt32BE(2,0);header.writeUInt32BE(1,4);header[8]=8;header[9]=6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.from([0,120,80,60,alpha,120,80,60,alpha]))),chunk('IEND',Buffer.alloc(0))]);
}

test('actual generated example has present, decodable assets and real transparency',async()=>{
  const result=await checkPack(example);assert.equal(result.ok,true,JSON.stringify(result.errors));
  assert.ok(result.images.cutout.fullyTransparentPixels>0);
  assert.ok(result.images.cutout.nearOpaquePixels>0);
});
test('opaque alpha-channel PNG is rejected as a cutout',async()=>sandbox(async dir=>{
  await writeFile(path.join(dir,'images/cutout.png'),png(255));
  assert.equal((await checkPack(dir)).ok,false);
}));
test('fully invisible PNG is rejected even though every pixel is transparent',async()=>sandbox(async dir=>{
  await writeFile(path.join(dir,'images/cutout.png'),png(0));
  assert.equal((await checkPack(dir)).ok,false);
}));
test('missing requested image cannot pass',async()=>sandbox(async dir=>{
  await rm(path.join(dir,'images/turnaround.png'));
  const result=await checkPack(dir);assert.equal(result.ok,false);assert.ok(result.errors.some(e=>e.startsWith('assets.turnaround:')));
}));
test('asset path escaping package is rejected',async()=>sandbox(async dir=>{
  await changeManifest(dir,d=>{d.assets.front='../outside.png'});
  const result=await checkPack(dir);assert.equal(result.ok,false);assert.ok(result.errors.some(e=>e.includes('包内相对路径')));
}));
test('missing generation reference cannot be passed off as a real input',async()=>sandbox(async dir=>{
  const p=path.join(dir,'generation-log.json'),log=JSON.parse(await readFile(p,'utf8'));
  log.steps[0].references=['images/nonexistent.png'];await writeFile(p,JSON.stringify(log));
  assert.ok((await checkPack(dir)).errors.some(e=>e.startsWith('generationLog:')));
}));
test('pending approval cannot be represented as a ready character',async()=>sandbox(async dir=>{
  await changeManifest(dir,d=>{d.status='ready';d.approval.status='pending'});
  assert.ok((await checkPack(dir)).errors.some(e=>e.includes('待确认')));
}));
test('truncated PNG is rejected',()=>{
  assert.throws(()=>inspectPng(png(255).subarray(0,40)));
});
