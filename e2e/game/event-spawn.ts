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
