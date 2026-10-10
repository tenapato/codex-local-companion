import test from 'node:test';
import assert from 'node:assert/strict';
import { networkConfig } from '../src/network.js';

test('non-loopback binding requires an explicit canonical public HTTPS origin',()=>{
  assert.deepEqual(networkConfig({}),{bind:'127.0.0.1',publicOrigin:undefined});
  assert.throws(()=>networkConfig({CLC_BIND:'0.0.0.0'}),/public_origin_required/);
  assert.throws(()=>networkConfig({CLC_BIND:'::'}),/invalid_bind/);
  for(const origin of ['http://codex.example.com','https://codex.example.com/path','https://user@codex.example.com','https://127.0.0.1','https://localhost','https://codex.example.com/','https://codex.example.com#fragment']){
    assert.throws(()=>networkConfig({CLC_BIND:'0.0.0.0',CLC_PUBLIC_ORIGIN:origin}),/invalid_public_origin/);
  }
  assert.deepEqual(networkConfig({CLC_BIND:'0.0.0.0',CLC_PUBLIC_ORIGIN:'https://codex.example.com'}),{bind:'0.0.0.0',publicOrigin:'https://codex.example.com'});
});
