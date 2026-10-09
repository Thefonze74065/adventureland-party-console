/** Read the native catalog used by timer-only runtime staging, before login. */
export async function nativeEventSpawn(admin: (code: string) => Promise<{map:string;x:number;y:number}>, event: string) {
  return admin(`output=(()=>{const event=${JSON.stringify(event)};
    const eventMap=Object.keys(G.maps).find(name=>G.maps[name].event===event);
    if(eventMap){const p=G.maps[eventMap].spawns[0];return {map:eventMap,x:p[0],y:p[1]};}
    for(const [map,definition] of Object.entries(G.maps)){
      const spawn=(definition.monsters||[]).find(entry=>entry.type===event);
      if(!spawn)continue;
      const bounds=spawn.boundary||spawn.boundaries?.[0];if(!Array.isArray(bounds))continue;
      const offset=typeof bounds[0]==='string'?1:0;
      const x=(Number(bounds[offset])+Number(bounds[offset+2]))/2,y=(Number(bounds[offset+1])+Number(bounds[offset+3]))/2;
      if(Number.isFinite(x)&&Number.isFinite(y))return {map,x,y};
    }throw Error('Native event catalog has no staging location: '+event);})()`);
}

/** Initial fixture position near actual monster bounds, verified against native geometry. */
export async function nativeMonsterInitialPosition(admin:(code:string)=>Promise<any>,monster:string){
  return admin(`output=(()=>{const type=${JSON.stringify(monster)};
    for(const [map,definition] of Object.entries(G.maps).sort(([a],[b])=>a.localeCompare(b)))
      for(const spawn of (definition.monsters||[]).filter(entry=>entry.type===type).sort((a,b)=>{
        const first=a.boundary||a.boundaries?.[0],second=b.boundary||b.boundaries?.[0];
        const center=bound=>{const offset=typeof bound?.[0]==='string'?1:0;return (Number(bound?.[offset])+Number(bound?.[offset+2]))/2;};
        return center(first)-center(second);
      })){
      if(spawn.type!==type)continue;
      const bounds=spawn.boundary||spawn.boundaries?.[0];if(!Array.isArray(bounds))continue;
      const offset=typeof bounds[0]==='string'?1:0;
      const center={x:(Number(bounds[offset])+Number(bounds[offset+2]))/2,y:(Number(bounds[offset+1])+Number(bounds[offset+3]))/2};
      if(!Number.isFinite(center.x)||!Number.isFinite(center.y))continue;
      const entity={type:'character',map,x:center.x,y:center.y};set_base(entity);
      for(const radius of [0,32,64,96,128])for(let i=0;i<(radius?16:1);i++){
        const angle=i*Math.PI/8,x=center.x+radius*Math.cos(angle),y=center.y+radius*Math.sin(angle);
        const origin={...entity,x,y};
        if(!can_move({...origin,going_x:x,going_y:y}))continue;
        if(![[24,0],[-24,0],[0,24],[0,-24]].every(([dx,dy])=>can_move({...origin,going_x:x+dx,going_y:y+dy})))continue;
        return {map,x,y,monster:type,bounds,center,base:entity.base,selfClear:true,localClearance:24};
      }
    }throw Error('No collision-safe native monster initial position: '+type);})()`);
}
