const test=require('node:test'),assert=require('node:assert/strict');
const {projectEventSchedules}=require('../../runtime/coordinator/events/schedule-reports.ts');
test('schedule reports select the newest feed on the leader realm and preserve input',()=>{
 const event={name:'abtesting',stale:true};const statuses={L:{server:'II',seenAt:200000},A:{server:'II',seenAt:200000,eventFeedAt:199000,eventSchedules:[event]},B:{server:'III',seenAt:200000,eventFeedAt:200000,eventSchedules:[{name:'other'}]}};
 assert.deepEqual(projectEventSchedules(statuses,'L',()=>200000),[{name:'abtesting',stale:false}]);assert.equal(event.stale,true);
 delete statuses.L.server;assert.deepEqual(projectEventSchedules(statuses,'L',()=>200000),[{name:'other',stale:false}]);
});
test('fresh connected change-only feeds retain schedules until disconnect or clock staleness',()=>{
 const report={seenAt:185000,eventFeedAt:80000,eventSchedules:[{name:'event'}]};
 assert.deepEqual(projectEventSchedules({A:report},'missing',()=>200000),[]);
 report.seenAt++;assert.equal(projectEventSchedules({A:report},'missing',()=>200000)[0].stale,false);
 report.eventFeedAt--;assert.equal(projectEventSchedules({A:report},'missing',()=>200000)[0].stale,false);
 report.eventFeedConnected=false;assert.equal(projectEventSchedules({A:report},'missing',()=>200000)[0].stale,true);
 report.eventFeedConnected=true;
 report.eventFeedAt=200000;report.eventClockStale=true;assert.equal(projectEventSchedules({A:report},'missing',()=>200000)[0].stale,true);
});
