import { notePreferenceWrite } from '../../../store/preference-writes.ts';

export interface PlaybackPreferences {defaultRate:number;continuous:boolean}
export const playbackRates=[0.5,0.75,1,1.25,1.5,1.75,2,2.5,3];
const key=(scope:string)=>'reader.media.playback-preferences.v1:'+scope;
const listeners=new Set<()=>void>();
function normalize(value:unknown):PlaybackPreferences {
  const raw=value&&typeof value==='object'?value as Partial<PlaybackPreferences>:{};
  return {defaultRate:playbackRates.includes(raw.defaultRate as number)?raw.defaultRate as number:1,continuous:typeof raw.continuous==='boolean'?raw.continuous:true};
}
export function readPlaybackPreferences(scope:string):PlaybackPreferences {
  try {return normalize(JSON.parse(localStorage.getItem(key(scope))??'null'));}
  catch{return {defaultRate:1,continuous:true};}
}
export function savePlaybackPreferences(scope:string,value:PlaybackPreferences){
  localStorage.setItem(key(scope),JSON.stringify(normalize(value)));
  notePreferenceWrite();
  for(const listener of listeners)listener();
}
export function subscribePlaybackPreferences(listener:()=>void):()=>void {
  listeners.add(listener);
  return ()=>{listeners.delete(listener);};
}
