const {publicStateFields}=require('../../../runtime/coordinator/telemetry/public-state-types.ts');
const {createPublicStateRoute}=require('../../../runtime/coordinator/telemetry/public-state.ts');
function publicStateRuntime(){
 const now=1000000;
 const party={...Object.fromEntries(publicStateFields.map(key=>[key,{field:key}])),
  statuses:{P:{name:'P',seenAt:now,server:'USII',map:'main',x:1,y:2,realmPlayers:['Alice','Bob'],
    items:[{slot:0,item:{name:'coat'},meta:{definition:{s:1},sprite:'sprite',unneeded:'omit-me'}},null],
    slots:{helmet:{item:{name:'helmet'},meta:{definition:{g:1}}}},characterDollHtml:'<div>doll</div>',nearbyGiveaways:[],nearbyStandListings:[],bank:{private:false}},
   Q:{name:'Q',seenAt:now-20000,server:'USII',realmPlayers:['Stale']}},
  commands:{P:{id:10,type:'party-monster-travel',phase:'assemble',convoyId:'convoy',private:'omit'},Q:null},
  location:{map:'main',x:100,y:200},abtestingStrategy:null,bankSnapshot:{packs:{items0:[]}},bankVaults:[{pack:'items0'}],
  bankboiQueue:[],bankboiTransaction:null,ponty:{listings:[]},autoUpgradeMarks:{P:{}},travelPlaces:[{map:'main'}],
  monsterChoices:[{id:'goo'}],bestiaryCatalog:[{id:'goo'}],skillCatalog:[{id:'attack'}],appearanceChoices:{eyes:[]},
  merchantCatalog:{allItems:[],buyable:[],craftable:[],exchangeable:[]},merchantQueue:[{id:'job',target:'P',reason:'restock'}],merchantCurrent:null,
  aldata:{merchants:[{id:'Trader',lastSeen:new Date(now-1000).toISOString(),serverRegion:'US',serverIdentifier:'II'},
    {id:'OldTrader',lastSeen:new Date(now-121000).toISOString(),serverRegion:'US',serverIdentifier:'II'}]}};
 const my_acc={response:{servers:[{key:'SR_USII'},{key:'SR_EUI'}]}},PARTY_CLASSES=['merchant','priest'];
 const funcs={publicHandoff:()=>({phase:'idle'}),publicALDataState:()=>({hasKey:true,listings:[{id:'listing'}],trades:[{id:'trade'}]}),
  rosterPayload:()=>[{name:'P'}],slotPayload:()=>[{character:'P',state:'online'}],publicEventSchedules:()=>[],publicAnniversaryState:()=>({live:false}),
  publicMerchantJob:job=>job&&({...job,priority:50}),mluckScheduleStatus:()=>[],bankboiPublicState:()=>[{name:'B'}],realmControlPayload:()=>({activeRealm:'SR_USII'})};
 const ports={now:()=>now,handoff:()=>funcs.publicHandoff(),aldata:()=>funcs.publicALDataState(),servers:()=>my_acc.response.servers,
  roster:()=>funcs.rosterPayload(),slots:()=>funcs.slotPayload(),classes:PARTY_CLASSES,eventSchedules:()=>funcs.publicEventSchedules(),
  anniversary:()=>funcs.publicAnniversaryState(),job:job=>funcs.publicMerchantJob(job),luckSchedule:()=>funcs.mluckScheduleStatus(),
  bankbois:()=>funcs.bankboiPublicState(),realmControl:()=>funcs.realmControlPayload()};
 return {party,ports,route:createPublicStateRoute(party,ports),legacy:{party,my_acc,PARTY_CLASSES,...funcs,Date:{now:()=>now,parse:Date.parse}}};
}
module.exports={publicStateRuntime};
