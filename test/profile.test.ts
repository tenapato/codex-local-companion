import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, mkdir, symlink, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareProfile } from '../src/runtime.js';
test('profile preparation refuses existing foreign state and symlinks',async()=>{
  const root=await mkdtemp(join(tmpdir(),'companion-profile-test-'));
  try{
    const foreign=join(root,'foreign');await mkdir(foreign,{mode:0o755});await writeFile(join(foreign,'unrelated'),'synthetic unrelated file');
    const mode=(await stat(foreign)).mode;
    await assert.rejects(prepareProfile(foreign),(e:any)=>e.code==='profile_not_owned');
    assert.equal((await stat(foreign)).mode,mode);assert.equal(await readFile(join(foreign,'unrelated'),'utf8'),'synthetic unrelated file');
    const link=join(root,'link');await symlink(foreign,link);await assert.rejects(prepareProfile(link),(e:any)=>e.code==='unsafe_profile');
    const owned=join(root,'owned');const profile=await prepareProfile(owned);
    assert.equal((await stat(owned)).mode&0o777,0o700);
    assert.ok((await readFile(join(profile,'config.toml'),'utf8')).includes('forced_login_method = "chatgpt"'));
  }finally{await rm(root,{recursive:true,force:true});}
});
