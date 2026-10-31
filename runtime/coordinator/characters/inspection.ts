import {createContext,runInContext} from 'node:vm';
import path from 'node:path';
import {requestObject,requestText,type HttpHandler} from '../http/contracts.ts';
import type {Item} from '../contracts/item.ts';

interface NativeProjection { game:Record<string,unknown>; project(type:string,level:number,slots:Record<string,unknown>,map:string):Record<string,unknown>; properties(item:Item):Record<string,unknown> }
interface Ports {
 owned(name:string):boolean; now():number; version():number; directory:string;
 read(file:string):string;
 fetch(name:string):Promise<unknown>;
 catalog():unknown[];
}
/** Native sources are the installed game's own cached assets, evaluated once
 * per version. Projection intentionally omits temporary effects/private boosts. */
function nativeProjection(ports:Ports):NativeProjection {
 const directory=path.resolve(ports.directory,'../game_files',String(ports.version()));
 const context=createContext({Place:'client'},{codeGeneration:{strings:false,wasm:false}});
 for(const filename of ['data.js','old_common_functions.js','stats.js'])runInContext(ports.read(path.join(directory,filename)),context,{filename,timeout:10000});
 runInContext('process_game_data(); var inspectionHelpers=ProgressionStats.helpers(G,{characterSlots:character_slots,doublehandTypes:doublehand_types});var inspectionProject=ProgressionStats.create(G,inspectionHelpers);',context,{timeout:10000});
 return {game:context.G,project:(type,level,slots,map)=>JSON.parse(JSON.stringify(context.inspectionProject(type,level,slots,map))),properties:item=>JSON.parse(JSON.stringify(context.inspectionHelpers.itemProperties(item)))};
}
const itemKeys=['name','level','q','l','b','p','stat_type','rid','gift','expires','acl'];
function item(raw:unknown):(Item & {name:string})|null {const value=requestObject(raw);if(typeof value.name!=='string')return null;return Object.fromEntries(itemKeys.filter(key=>key in value).map(key=>[key,value[key]])) as Item & {name:string};}
const number=(value:unknown)=>Number.isFinite(Number(value))?Number(value):0;
function projectSaved(native: NativeProjection | undefined, profile: Record<string, unknown> & {class:string}, equipment: Record<string, unknown>): Record<string, unknown> | undefined {
 try{return native?.project(profile.class,number(profile.level),equipment,requestText(profile.map)||'main');}catch{return undefined;}
}
function savedProfile(value: unknown, name: string): Record<string, unknown> & {class: string; inventory: unknown[]} {
 const reply=requestObject(value),profile=requestObject(reply.profile);
 if(reply.success!==true || profile.name!==name || typeof profile.class!=='string' || !Array.isArray(profile.inventory) || !profile.equipment)throw Error('The game did not return an owned saved character profile');
 return {...profile, class:profile.class, inventory:profile.inventory};
}
export function characterInspectionRoute(ports:Ports):HttpHandler {
 const cache=new Map<string,{at:number;value:unknown}>(),pending=new Map<string,Promise<unknown>>();
 let preparedVersion:number|undefined,native:NativeProjection|undefined;
 function prepare(){if(preparedVersion===ports.version())return;preparedVersion=ports.version();try{native=nativeProjection(ports);}catch{native=undefined;}}
 async function inspect(name:string){
  const cached=cache.get(name);if(cached && ports.now()-cached.at<30000)return cached.value;
  if(pending.has(name))return pending.get(name);
  const operation=(async()=>{
   const profile = savedProfile(await ports.fetch(name), name), ctype=profile.class;
   prepare();
   const equipment=Object.fromEntries(Object.entries(requestObject(profile.equipment)).map(([slot,entry])=>[slot,item(entry)]));
   const calculated=projectSaved(native,profile,equipment);
   function entry(raw:unknown,slot?:number){const owned=item(raw);if(!owned)return null;const known=ports.catalog().find(entry=>requestObject(entry).id===owned.name);const knownMeta=requestObject(known).meta;let meta=requestObject(knownMeta);if(native){const definition=requestObject(requestObject(native.game.items)[owned.name]);try{meta={...meta,definition,properties:native.properties(owned),upgradeable:!!definition.upgrade,compoundable:!!definition.compound,scaling:definition.upgrade || definition.compound || {},maxLevel:definition.compound?7:13};}catch{/* Keep available catalog card data. */}}return{...(slot===undefined?{}:{slot}),item:owned,meta};}
   const stats=calculated || {},base={name,ctype,level:number(profile.level),xp:number(profile.xp),max_xp:number(requestObject(native?.game.levels)[String(profile.level)]),hp:number(profile.hp),mp:number(profile.mp),gold:number(profile.gold),map:requestText(profile.map)||'unknown',x:number(profile.x),y:number(profile.y),rip:profile.rip===true,banking:false,seenAt:0,updatedAt:ports.now(),items:profile.inventory.slice(0,100).map((raw,slot)=>entry(raw,slot)),slots:Object.fromEntries(Object.entries(equipment).map(([slot,raw])=>[slot,entry(raw)])),max_hp:number(stats.max_hp),max_mp:number(stats.max_mp),inspection:{source:'account-snapshot',calculated:!!calculated,synchronizedAt:typeof profile.synchronized_at==='string'?profile.synchronized_at:null,note:calculated?'Calculated from saved level and equipment; temporary effects and private account bonuses are not included.':'Derived stats unavailable for this saved profile.'}};
   const derived=Object.fromEntries(['attack','frequency','range','speed','armor','resistance','str','int','dex','vit','luck'].filter(key=>typeof stats[key]==='number').map(key=>[key,stats[key]]));
   const value={character:{...base,...derived,primaryStat:requestObject(requestObject(native?.game.classes)[ctype]).main_stat,fortitude:stats.for,...(calculated?{luck:Math.round(number(stats.luckm)*100),goldBonus:(number(stats.goldm)-1)*100,xpBonus:(number(stats.xpm)-1)*100}:{}),combatStats:calculated?Object.fromEntries(Object.entries({heal:'heal',output:'output',mpCost:'mp_cost',crit:'crit',critDamage:'critdamage',evasion:'evasion',miss:'miss',lifesteal:'lifesteal',manasteal:'manasteal',damageReturn:'dreturn',reflection:'reflection',armorPiercing:'apiercing',resistancePiercing:'rpiercing',poisonResistance:'pnresistance',fireResistance:'firesistance',freezeResistance:'fzresistance',physicalResistance:'phresistance',statusResistance:'stresistance',blastResistance:'bmresistance'}).map(([key,field])=>[key,number(stats[field])])):undefined}};
   cache.set(name,{at:ports.now(),value});return value;
  })();pending.set(name,operation);try{return await operation;}finally{pending.delete(name);}
 }
 return async(req,res)=>{const name=req.params.name;if(!name || !ports.owned(name))return res.status(404).json({error:'Character is not owned by this account'});try{return res.json(await inspect(name));}catch(error){return res.status(502).json({error:error instanceof Error?error.message:'Could not read saved character'});}};
}
