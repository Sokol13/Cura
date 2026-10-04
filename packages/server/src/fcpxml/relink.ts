/** Original, dependency-free utility embedded in every package; no Apple DTD redistribution. */
export const relinkScript = String.raw`#!/usr/bin/env node
import { readFile, realpath, open, writeFile, rename, rm } from 'node:fs/promises';
import { resolve, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
const escape = value => value.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
try {
 const root=await realpath(process.argv[2] ? resolve(process.argv[2]) : dirname(fileURLToPath(import.meta.url)));
 const manifest=JSON.parse(await readFile(resolve(root,'manifest.json'),'utf8'));
 if(manifest.format!=='cura-fcpxml/1'||manifest.fcpxmlVersion!=='1.7'||!Array.isArray(manifest.media)||manifest.media.length>1000)throw new Error('Unsupported manifest');
 const targets=new Map();
 for(const media of manifest.media) {
  if(!/^asset-[a-f\d-]{36}$/.test(media.resourceId)||targets.has(media.resourceId)||typeof media.path!=='string'||!media.path.startsWith('media/')||media.path.includes('\\')||media.path.split('/').some(p=>p==='..'||p==='.'||p===''))throw new Error('Invalid media reference');
  const path=await realpath(resolve(root,...media.path.split('/'))), inside=relative(root,path);
  if(inside.startsWith('..')||isAbsolute(inside))throw new Error('Media escapes package');
  const file=await open(path,'r');
  try {
   const hash=createHash('sha256'); let bytes=0;
   for await(const chunk of file.createReadStream({autoClose:false})) {hash.update(chunk);bytes+=chunk.length;}
   if(hash.digest('hex')!==media.hash||bytes!==media.size)throw new Error('Retained media hash or size mismatch');
  }finally{await file.close();}
  targets.set(media.resourceId,pathToFileURL(path).href);
 }
 const xmlPath=resolve(root,'timeline.fcpxml'); let xml=await readFile(xmlPath,'utf8'); const seen=new Set();
 if(!xml.includes('<fcpxml version="1.7">')||xml.includes('<!ENTITY'))throw new Error('Unsupported XML document');
 xml=xml.replace(/<asset\s[^>]*\/>/g,tag=>{
  const id=/\bid="([^"]+)"/.exec(tag)?.[1];
  if(!targets.has(id)||seen.has(id)||! /\bsrc="[^"]*"/.test(tag))throw new Error('Unknown or duplicate XML resource');
  seen.add(id);return tag.replace(/\bsrc="[^"]*"/,'src="'+escape(targets.get(id))+'"');
 });
 if(seen.size!==targets.size)throw new Error('Missing XML media resources');
 const temporary=xmlPath+'.'+randomUUID()+'.partial';
 try{await writeFile(temporary,xml,{flag:'wx'});await rename(temporary,xmlPath);}finally{await rm(temporary,{force:true});}
 console.log('Relinked '+targets.size+' verified media files. Import '+xmlPath);
}catch(error){console.error('Relink failed: '+error.message);process.exitCode=1;}
`;
