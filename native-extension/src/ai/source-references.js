import {fail} from './protocol.js';
// Both provisional and final chapters point to the same immutable source cue.
export function cueTimestamp(input,ref,allowedRefs){
 if(!Number.isInteger(ref)||ref<1||ref>(input?.cues?.length||0)||allowedRefs&&!allowedRefs.has(ref))fail('CUSTOM_INVALID_RESPONSE');
 return Math.round(input.cues[ref-1].start*1000);
}
