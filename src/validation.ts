import AjvModule from 'ajv';
import { Failure } from './errors.js';
const Ajv = AjvModule.default;
export const ajv = new Ajv({strict:true,allErrors:false,validateFormats:false});
export type Input = { instructions:string; messages:{role:'user'|'assistant';content:string}[]; model:string; effort:string; outputSchema?:Record<string,unknown> };
export function input(value: any): Input {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Failure('invalid_input');
  const allowed=['instructions','messages','model','effort','outputSchema'];
  if (Object.keys(value).some(k=>!allowed.includes(k))) throw new Failure('invalid_input');
  if (typeof value.instructions !== 'string' || value.instructions.length > 8000) throw new Failure('invalid_input');
  for (const key of ['model','effort']) if (typeof value[key] !== 'string' || !value[key].length || value[key].length > 160) throw new Failure('invalid_input');
  if (!Array.isArray(value.messages) || !value.messages.length || value.messages.length > 32) throw new Failure('invalid_input');
  let total = value.instructions.length;
  for (const m of value.messages) {
    if (!m || Object.keys(m).some(k=>!['role','content'].includes(k)) || !['user','assistant'].includes(m.role) || typeof m.content !== 'string' || m.content.length > 16000) throw new Failure('invalid_input');
    total += m.content.length;
  }
  if (total > 64000) throw new Failure('input_too_large',413);
  if (value.outputSchema !== undefined) {
    if (!value.outputSchema || typeof value.outputSchema !== 'object' || Array.isArray(value.outputSchema)) throw new Failure('invalid_output_schema');
    const text = JSON.stringify(value.outputSchema);
    if (text.length > 16000) throw new Failure('invalid_output_schema');
    let count=0;
    const walk=(v:any,depth=0)=>{
      if (++count>1000 || depth>16) throw new Failure('invalid_output_schema');
      if (v && typeof v==='object') {
        if (v.$ref || v.$dynamicRef || v.$recursiveRef || v.pattern || v.patternProperties) throw new Failure('invalid_output_schema');
        Object.values(v).forEach(x=>walk(x,depth+1));
      }
    };
    walk(value.outputSchema);
    try { ajv.compile(value.outputSchema); } catch { throw new Failure('invalid_output_schema'); }
    finally { ajv.removeSchema(value.outputSchema); }
  }
  return value;
}
