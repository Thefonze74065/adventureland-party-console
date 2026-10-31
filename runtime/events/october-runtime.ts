import {affordableMix, cipherCandidates, cipherIngredients, defaultCipherSettings, solveCipher, trickOrTreatRoute, validMix, type CipherBoard, type CipherSettings, type CipherGatheringPlan, type CipherGatheringContext} from './october.ts';

interface Point {map:string;x:number;y:number}
interface EventDefinition {
  doors?: [string,number,number][];
  ingredients?: [string,string[]][];
}
interface Activity {name:string;state:Record<string,unknown>;types:string[];kind:string}
interface Receipt {success?:boolean;failed?:boolean;reason?:string;mixes?:number;mixes_left?:number;server?:string;[key:string]:unknown}
interface Journal {
  day:string; doors:number[]; doorLimit?:boolean;
  gathering?:CipherGatheringPlan;
  pending?: {key:string;round:string;cracks:number;mix:string[];before:number;at:number};
  handled?:string[]; last?:{at:number;action:string;result:unknown};
}
export interface OctoberPorts {
  now():number; realm():string; name():string; merchant():boolean;
  settings():Record<string,{monsters?:string[];cipher?:CipherSettings}>;
  status():{halloween?:unknown;witchcipher?:CipherBoard};
  definitions():Record<string,EventDefinition>;
  position():Point; stock():Record<string,number>;
  inventorySpace?():number;
  gathering():CipherGatheringContext|null;
  doorStatus():{doors?:number[];doors_left?:number}|null;
  load():Journal|null; save(journal:Journal):void;
  walk(point:Point,owns:()=>boolean):Promise<unknown>;
  knock(door:number):Promise<Receipt>; info():Promise<Receipt>; brew(mix:string[]):Promise<Receipt>;
  farmDestination(monster:string):Point|null; witch():Point|null;
  transfer():Promise<void>;
}
export function createOctoberRuntime(ports:OctoberPorts) {
  let journal=ports.load(), phase='idle', detail='', retryAt=0, working=false;
  let dayInfo:Receipt|null=null, infoAt=0, solutionKey='', solution:ReturnType<typeof solveCipher>|null=null;
  function current() {
    const day=new Date(ports.now()).toISOString().slice(0,10);
    if(!journal || journal.day!==day){journal={day,doors:[],handled:journal?.handled??[],pending:journal?.pending,gathering:journal?.gathering};ports.save(journal);dayInfo=null;infoAt=0;}
    const native=ports.doorStatus();
    if(native?.doors && ports.now()%86400000>5000){
      const merged=[...new Set([...journal.doors,...native.doors.filter(id=>Number.isInteger(id)&&id>=0&&id<7)])];
      if(merged.length!==journal.doors.length){journal.doors=merged;ports.save(journal);}
    }
    return journal;
  }
  function config(){return {...defaultCipherSettings,...ports.settings().witchcipher?.cipher};}
  function planFor(board:CipherBoard){
    const saved=current(), context=ports.gathering();
    if(!board.id || !context || context.round!==board.id)return undefined;
    const matches=(plan:CipherGatheringPlan|undefined)=>!!plan&&plan.round===board.id&&plan.realm===ports.realm()&&plan.owner===context.owner;
    if(matches(context.plan)&&(!matches(saved.gathering)||context.plan!.selectedAt>saved.gathering!.selectedAt)){
      saved.gathering=context.plan;ports.save(saved);
    }
    if(matches(saved.gathering)){
      if(saved.gathering!.mode==='gathering'&&ports.now()>=Number(board.gather_end)){
        if(context.owner===ports.name()&&context.ready)return selectPlan(board,undefined,'gathering ended',!cipherIngredients.every(id=>(context.stock[id]??0)>0));
        // Stop pulling immediately at the native cutoff while the owner's
        // fresh inventory decision propagates to the rest of the party.
        return undefined;
      }
      return saved.gathering;
    }
    // One owner chooses from a fresh party inventory snapshot. Every follower
    // and the merchant adopt its persisted plan, never their individual stock.
    if(context.owner!==ports.name() || !context.ready)return undefined;
    const ingredient=cipherIngredients.every(id=>(context.stock[id]??0)>0)?undefined:
      cipherIngredients.reduce((lowest,id)=>(context.stock[id]??0)<(context.stock[lowest]??0)?id:lowest);
    return selectPlan(board,ingredient,'initial stock',!!ingredient&&ports.now()>=Number(board.gather_end));
  }
  function selectPlan(board:CipherBoard,ingredient:typeof cipherIngredients[number]|undefined,reason:CipherGatheringPlan['reason'],finished=false){
    const context=ports.gathering();if(!context||!board.id)return undefined;
    const rules=ports.definitions().witchcipher?.ingredients??[];
    const index=rules.findIndex(entry=>entry[0]===ingredient);
    const selected=config().gatherMonsters?.[index];
    const monster=rules[index]?.[1].includes(selected??'')?selected:rules[index]?.[1][0];
    if(ingredient&&!monster)return undefined;
    current().gathering={round:board.id,realm:ports.realm(),owner:context.owner,mode:finished?'finished':ingredient?'gathering':'brewing',reason,
      ingredient,monster,stock:{...context.stock},selectedAt:ports.now()};
    ports.save(current());return current().gathering;
  }
  function gathering(board:CipherBoard){return planFor(board)?.mode==='gathering';}
  function gatherType(board:CipherBoard){return planFor(board)?.monster;}
  function manual(board:CipherBoard){const value=config().manual;return value && value.round===board.id && value.cracks===(board.cracks??0) && !current().handled?.includes(value.id)?value:null;}
  function activity(name:string):Activity|null {
    if(name==='trickortreat'&&ports.merchant()&&ports.inventorySpace?.()===0){
      phase='waiting for inventory capacity';detail='Free inventory space before visiting doors';return null;
    }
    const status=ports.status(), saved=current();
    if(name==='trickortreat')return status.halloween && ports.doorStatus()?.doors_left!==0 && !saved.doorLimit && saved.doors.length<7
      ? {name,state:{id:'doors:'+saved.day},types:[],kind:'interaction'}:null;
    const board=status.witchcipher;
    if(name!=='witchcipher' || !board?.live || !(Number(board.end)>ports.now()))return null;
    const plan=planFor(board);
    if(!plan){phase='waiting for inventory';detail='Waiting for a fresh shared ingredient inventory';return null;}
    if(plan.mode==='finished'&&!manual(board)){phase='finished';detail='Gathering ended without enough ingredients; returning to farming';return null;}
    if(gathering(board) && !manual(board)){
      const type=gatherType(board);
      phase='gathering';detail=type?'Farming '+type+' for '+saved.gathering?.ingredient:'Waiting for a fresh shared ingredient inventory';
      return type?{name,state:board as Record<string,unknown>,types:[type],kind:'monster'}:null;
    }
    if(!config().automatic && !manual(board) && !saved.pending)return null;
    if(ports.gathering()?.mixesLeft===0&&!saved.pending)return null;
    if(dayInfo && Number(dayInfo.mixes_left)<=0 && !saved.pending)return null;
    return {name,state:board as Record<string,unknown>,types:[],kind:'interaction'};
  }
  function destination(name:string):Point|null {
    if(name==='trickortreat'){
      const id=trickOrTreatRoute.find(door=>!current().doors.includes(door));
      const point=id===undefined?null:ports.definitions().trickortreat?.doors?.[id];
      return point?{map:point[0],x:point[1],y:point[2]+40}:null;
    }
    const board=ports.status().witchcipher;
    const type=board && gathering(board) && !manual(board)?gatherType(board):null;
    return type?ports.farmDestination(type):ports.witch();
  }
  function saveResult(action:string,result:unknown){current().last={at:ports.now(),action,result};ports.save(current());}
  async function doors(owns:()=>boolean){
    const saved=current();
    for(const door of trickOrTreatRoute){
      if(!owns() || saved!==current() || saved.doorLimit)return;
      if(saved.doors.includes(door))continue;
      const point=ports.definitions().trickortreat?.doors?.[door];
      if(!point)throw Error('Native door catalog unavailable');
      phase='visiting door '+(door+1);detail='';
      await ports.walk({map:point[0],x:point[1],y:point[2]+40},owns);
      if(!owns())return;
      const position=ports.position();
      if(position.map!==point[0] || Math.hypot(position.x-point[1],position.y-point[2])>75)return;
      try{const receipt=await ports.knock(door);if(receipt.failed)throw receipt;saved.doors.push(door);saveResult('knock '+door,receipt);}
      catch(error){const reason=(error as Receipt)?.reason;
        if(reason==='trickortreat_knocked')saved.doors.push(door);
        else if(reason==='trickortreat_limit')saved.doorLimit=true;
        else throw error;
        saveResult('knock '+door,error);
      }
    }
    phase='complete';detail='Daily door route complete; returning to farming';
  }
  async function refreshInfo(){dayInfo=await ports.info();infoAt=ports.now();return dayInfo;}
  async function reconcile(){
    const saved=current(), pending=saved.pending;
    if(!pending)return true;
    const day=await refreshInfo();
    // An unknown request may have consumed one of the shared attempts. Never
    // replay it merely because the callback or a new board was lost.
    if(Number(day.mixes)>pending.before){
      saved.handled=[...(saved.handled??[]),pending.key].slice(-32);delete saved.pending;
      saveResult('reconciled brew',{mixes:day.mixes,unknownOutcome:true});return true;
    }
    phase='uncertain';detail='Waiting for confirmation of the previous brew; no retry will spend another mix';return false;
  }
  async function cipher(owns:()=>boolean){
    await ports.transfer();
    let board=ports.status().witchcipher;
    if(!ports.merchant() || !board || gathering(board) && !manual(board))return;
    if(!await reconcile() || !owns())return;
    const settings=config(), request=manual(board);
    if(!settings.automatic && !request)return;
    if(!dayInfo || ports.now()-infoAt>10_000)await refreshInfo();
    if(!owns() || !dayInfo || Number(dayInfo.mixes_left)<=0){phase='daily limit';return;}
    if(dayInfo.server && dayInfo.server!==ports.realm()){phase='other realm';detail='Today’s mixes belong to '+dayInfo.server;return;}
    const target=ports.witch();if(!target)throw Error('Witch location unavailable');
    phase='walking to witch';detail='';await ports.walk(target,owns);if(!owns())return;
    board=ports.status().witchcipher;if(!board?.live || Number(board.end)<=ports.now())return;
    if(!request && (board.mixes??board.board?.length??0)<config().minClues){phase='waiting for clues';detail=`Need ${config().minClues} clues`;return;}
    const position=ports.position();if(position.map!==target.map||Math.hypot(position.x-target.x,position.y-target.y)>55)return;
    const stock=ports.stock(), liveRequest=manual(board);
    let mix:string[]|null=null;
    if(request){
      if(liveRequest?.id!==request.id)return;
      mix=request.mix;
      if(!validMix(mix)||!cipherCandidates(board).some(candidate=>candidate.join(',')===mix!.join(','))){phase='manual conflict';detail='The requested mix no longer fits this recipe’s clues';return;}
    }else{
      if(!config().automatic || (board.mixes??board.board?.length??0)<config().minClues)return;
      const sharedStock=ports.gathering()?.ready?ports.gathering()!.stock:stock;
      const key=JSON.stringify([board,sharedStock]);
      if(key!==solutionKey){solution=solveCipher(board,sharedStock);solutionKey=key;}
      mix=solution?.mix??null;
    }
    if(!mix){phase='waiting for clues';detail='No untried recipe fits the available clues';return;}
    if(!affordableMix(mix,stock)){
      const context=ports.gathering();
      if(!context?.ready||affordableMix(mix,context.stock)){phase='waiting for ingredients';detail='Waiting for the party to transfer ingredients';return;}
      const missing=cipherIngredients.filter(id=>mix!.filter(value=>value===id).length>(context.stock[id]??0));
      const ingredient=missing.reduce((lowest,id)=>(context.stock[id]??0)<(context.stock[lowest]??0)?id:lowest);
      if(request)current().handled=[...(current().handled??[]),request.id].slice(-32);
      selectPlan(board,ingredient,'recipe shortage',ports.now()>=Number(board.gather_end));
      phase='ingredients needed';detail='Recipe needs '+ingredient;return;
    }
    if(board.board?.some(clue=>clue.mix.join(',')===mix!.join(','))){phase='already tried';return;}
    await refreshInfo();if(!owns() || Number(dayInfo?.mixes_left)<=0)return;
    const latest=ports.status().witchcipher;
    if(JSON.stringify(latest)!==JSON.stringify(board))return;
    const key=request?.id??`${board.id}:${board.cracks??0}:${mix.join(',')}`;
    if(current().handled?.includes(key)){phase='waiting for board';detail='Previous brew is confirmed; waiting for the realm board update';return;}
    current().pending={key,round:String(board.id),cracks:board.cracks??0,mix:mix.slice(),before:Number(dayInfo?.mixes)||0,at:ports.now()};
    ports.save(current());phase='brewing';
    try{
      const receipt=await ports.brew(mix);if(receipt.failed)throw receipt;
      current().handled=[...(current().handled??[]),key].slice(-32);delete current().pending;
      dayInfo={...dayInfo,mixes:Number(dayInfo?.mixes)+1,mixes_left:receipt.mixes_left};infoAt=ports.now();
      saveResult('brew',receipt);phase=receipt.cracked?'recipe solved':'clue received';solutionKey='';
    }catch(error){
      const reason=(error as Receipt)?.reason;
      if(reason && !['timeout','disconnected','queue_overflow'].includes(reason))delete current().pending;
      saveResult('brew failed',error);throw error;
    }
  }
  async function run(name:string,owns:()=>boolean){
    if(working||ports.now()<retryAt)return;
    working=true;
    try{if(name==='trickortreat')await doors(owns);else if(name==='witchcipher')await cipher(owns);}
    catch(error){detail=String((error as Receipt)?.reason??(error as Error)?.message??error);phase='retry waiting';retryAt=ports.now()+15_000;}
    finally{working=false;}
  }
  return {activity,destination,run,transfer:()=>ports.transfer(),snapshot:()=>({phase,detail,day:dayInfo,journal:current(),stock:ports.stock(),candidates:solution?.candidates})};
}
