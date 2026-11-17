#!/usr/bin/env node
// Copyright (c) 2026 阿杜 (Adu). MIT; see ../LICENSE.
// Read-only structural checks; visual identity and rights require human review.
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const MAX_FILE = 64 * 1024 * 1024;
const MAX_PIXELS = 16 * 1024 * 1024;

function fail(message) { throw new Error(message); }
function record(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function nonempty(value) { return typeof value === 'string' && value.trim().length > 0; }
function paeth(a, b, c) {
  const p = a + b - c, da = Math.abs(p-a), db = Math.abs(p-b), dc = Math.abs(p-c);
  return da <= db && da <= dc ? a : db <= dc ? b : c;
}

export function inspectPng(bytes) {
  if (bytes.length < 33 || !bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) fail('不是 PNG 文件');
  if (bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii',12,16) !== 'IHDR') fail('缺少有效 IHDR');
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  const bitDepth = bytes[24], colorType = bytes[25], interlace = bytes[28];
  if (!width || !height || width * height > MAX_PIXELS) fail('图片尺寸无效或超过检查上限');
  if (bytes[26] !== 0 || bytes[27] !== 0) fail('不支持的 PNG 压缩或过滤方式');
  let offset=8, ended=false;
  const idat=[];
  while (offset + 12 <= bytes.length) {
    const length=bytes.readUInt32BE(offset), type=bytes.toString('ascii',offset+4,offset+8);
    if (offset + 12 + length > bytes.length) fail('PNG 数据块不完整');
    if (type === 'IDAT') idat.push(bytes.subarray(offset+8,offset+8+length));
    if (type === 'IEND') { if (length !== 0) fail('IEND 长度无效'); ended=true; break; }
    offset += length+12;
  }
  if (!ended || !idat.length) fail('PNG 缺少图像数据或结束块');
  const channels={0:1,2:3,3:1,4:2,6:4}[colorType];
  const allowedDepths={0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]};
  if (!channels || !allowedDepths[colorType].includes(bitDepth)) fail('PNG 颜色类型或位深无效');
  const alphaChannel=colorType === 4 || colorType === 6;
  const info={width,height,bitDepth,colorType,alphaChannel,transparencyChecked:false,transparentPixels:null};
  // Palette tRNS and Adam7 files can still be valid PNGs; do not claim their
  // transparency is verified by this small checker.
  if (interlace !== 0) return {...info,note:'交错 PNG 的透明像素需用图像工具另查'};
  const rowBytes=Math.ceil(width*channels*bitDepth/8), bpp=Math.max(1,Math.ceil(channels*bitDepth/8));
  const expected=(rowBytes+1)*height;
  if (expected > MAX_FILE) fail('解码大小超过检查上限');
  const raw=inflateSync(Buffer.concat(idat),{maxOutputLength:expected+1});
  if (raw.length !== expected) fail('PNG 解压数据长度不匹配');
  let previous=Buffer.alloc(rowBytes), transparent=0, fullyTransparent=0, nearOpaque=0, minAlpha=65535, maxAlpha=0;
  const cornerAlpha=[];
  for (let y=0;y<height;y++) {
    const start=y*(rowBytes+1), filter=raw[start], row=Buffer.from(raw.subarray(start+1,start+1+rowBytes));
    if (filter > 4) fail('PNG 过滤类型无效');
    for (let x=0;x<rowBytes;x++) {
      const left=x>=bpp?row[x-bpp]:0, up=previous[x], corner=x>=bpp?previous[x-bpp]:0;
      const add=filter===0?0:filter===1?left:filter===2?up:filter===3?Math.floor((left+up)/2):paeth(left,up,corner);
      row[x]=(row[x]+add)&255;
    }
    if (alphaChannel) {
      const sample=bitDepth/8, stride=channels*sample;
      for (let x=0;x<width;x++) {
        const a=x*stride+(channels-1)*sample;
        const alpha=sample===1?row[a]:row.readUInt16BE(a), limit=sample===1?255:65535;
        if (alpha < limit) transparent++;
        if (alpha === 0) fullyTransparent++;
        if (alpha >= limit*0.98) nearOpaque++;
        minAlpha=Math.min(minAlpha,alpha); maxAlpha=Math.max(maxAlpha,alpha);
        if ((y===0 || y===height-1) && (x===0 || x===width-1)) cornerAlpha.push(alpha/limit);
      }
    }
    previous=row;
  }
  if (alphaChannel) return {...info,transparencyChecked:true,transparentPixels:transparent,transparentFraction:transparent/(width*height),fullyTransparentPixels:fullyTransparent,nearOpaquePixels:nearOpaque,minAlpha,maxAlpha,cornerAlpha};
  return {...info,note:'无独立 alpha 通道；tRNS 透明度不在本检查器解码范围内'};
}

export async function checkPack(directory) {
  const errors=[], images={};
  const root=await realpath(directory);
  async function localFile(relative) {
    if (!nonempty(relative) || /^(?:[a-z]:|[\\/])/i.test(relative) || relative.includes('\0') || relative.replaceAll('\\','/').split('/').includes('..')) fail('文件路径必须为包内相对路径');
    const target=await realpath(path.resolve(root,relative));
    const delta=path.relative(root,target);
    if (delta.startsWith('..'+path.sep) || delta==='..' || path.isAbsolute(delta)) fail('文件指向角色包外部');
    const s=await stat(target);
    if (!s.isFile() || s.size>MAX_FILE) fail('文件不可读或超出大小上限');
    return target;
  }
  async function jsonFile(relative) {
    const p=await localFile(relative);
    if ((await stat(p)).size>1024*1024) fail('JSON 超过检查上限');
    return JSON.parse(await readFile(p,'utf8'));
  }
  let data;
  try { data=await jsonFile('character.json'); } catch(e) { return {ok:false,errors:['character.json: '+e.message],images}; }
  if (!record(data)) return {ok:false,errors:['character.json 必须是对象'],images};
  if (data.schemaVersion!==1) errors.push('schemaVersion 应为 1');
  if (!nonempty(data.id) || data.id.length>64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(data.id)) errors.push('id 格式无效');
  for (const key of ['displayName','style','license']) if (!nonempty(data[key])) errors.push(key+' 不能为空');
  if (!['photo','character','text'].includes(data.inputKind)) errors.push('inputKind 无效');
  if (!['draft','ready','needs-revision'].includes(data.status)) errors.push('status 无效');
  if (!record(data.approval) || !['pending','confirmed','delegated'].includes(data.approval.status) || !nonempty(data.approval.note)) errors.push('approval 缺少有效状态或依据');
  if (data.status==='ready' && data.approval?.status==='pending') errors.push('待确认角色不能标为 ready');
  if (!Array.isArray(data.lockedFeatures) || !data.lockedFeatures.length || data.lockedFeatures.some(x=>!nonempty(x))) errors.push('lockedFeatures 必须为非空特征数组');
  const assets=record(data.assets)?Object.entries(data.assets):[];
  if (!assets.length) errors.push('assets 至少需要一张实际图片');
  for (const [role,file] of assets) {
    try {
      if (!['front','turnaround','cutout','portrait'].includes(role)) fail('未知资产类型');
      const info=inspectPng(await readFile(await localFile(file)));
      images[role]={file,...info};
      if (role==='cutout' && (!info.transparencyChecked || !info.fullyTransparentPixels || !info.nearOpaquePixels || info.cornerAlpha.some(a=>a>0.02))) fail('未验证到透明背景和可见前景；不能当作已通过的透明人物图');
    } catch(e) { errors.push('assets.'+role+': '+e.message); }
  }
  for (const key of ['characterSpec','review']) {
    try { const p=await localFile(data[key]); if (!(await readFile(p,'utf8')).trim()) fail('文件为空'); }
    catch(e) { errors.push(key+': '+e.message); }
  }
  try {
    const log=await jsonFile(data.generationLog);
    if (!record(log) || log.schemaVersion!==1 || !Array.isArray(log.steps) || !log.steps.length) fail('需要 schemaVersion:1 和非空 steps');
    for (const [index,step] of log.steps.entries()) {
      if (!record(step)) fail('步骤必须是对象');
      for (const key of ['id','tool','model','intent','prompt']) if (!nonempty(step[key])) fail('步骤 '+index+' 缺少 '+key);
      if (!['succeeded','failed'].includes(step.result)) fail('步骤 result 无效');
      if (!Array.isArray(step.references)) fail('步骤 references 必须是数组');
      for (const ref of step.references) await localFile(ref);
      if (step.result==='succeeded') await localFile(step.output);
      else if (step.output!==null) fail('失败步骤的 output 应为 null');
    }
  } catch(e) { errors.push('generationLog: '+e.message); }
  return {ok:errors.length===0,characterId:data.id,errors,images,note:'仅文件与 PNG 检查；不判断人物一致性、用户确认真实性或版权'};
}

if (typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  if (process.argv.length!==3) {
    console.error('用法：node scripts/check-pack.mjs <角色包目录>'); process.exitCode=2;
  } else {
    try { const result=await checkPack(process.argv[2]); console.log(JSON.stringify(result,null,2)); process.exitCode=result.ok?0:1; }
    catch(e) { console.log(JSON.stringify({ok:false,errors:[e.message]})); process.exitCode=1; }
  }
}
