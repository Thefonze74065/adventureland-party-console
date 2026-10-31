import {test,expect} from './fixtures';
import {writeFileSync,readFileSync} from 'node:fs';
import path from 'node:path';

test.describe('Mailbox enhancements',()=>{
 test.use({mailbox:true,merchantDialogs:true,merchantConnected:true});
 test('mailbox auto-delete isolates a native exception and recovers after restart',async({page,app},info)=>{
  // Failure modes: one rejected deletion starves later collected mail; a fresh
  // listing is mislabeled stale; failed deletion disappears; unsafe mail is deleted;
  // refresh hammering retries the same failure; restart loses the enabled setting.
  const fault=path.join(path.dirname(app.journal),'mail-delete-fault.json'),ledger=path.join(path.dirname(app.journal),'mail-delete-ledger.jsonl');
  writeFileSync(fault,JSON.stringify({blocked:['mail-collected']}));
  await page.goto('/');await page.getByRole('button',{name:/^Mail/}).click();
  const dialog=page.getByRole('dialog',{name:'Mail',exact:true});
  const autoDelete=dialog.getByLabel('Automatically delete messages after attachments are collected',{exact:true});
  await autoDelete.click();await expect(autoDelete).toBeChecked();
  await expect(dialog.getByRole('button',{name:/Second collected attachment fixture/})).toHaveCount(0);
  await expect(dialog.getByText(/Automatic mail deletion failed.*exception/)).toBeVisible();
  await expect(dialog.getByText(/Mail may be out of date/)).toHaveCount(0);
  const box=await (await page.request.get(app.url+'/party-api/mail')).json();
  expect(box.error).toBeNull();expect(box.settings).toEqual({autoCollect:false,autoDelete:true});
  expect(box.messages.map((mail:any)=>mail.id).sort()).toEqual(['mail-collected','mail-pending','mail-text','mail-unclaimed']);
  await page.request.post(app.url+'/party-api/mail/refresh',{headers:{Origin:app.url},data:{}});
  const attempts=readFileSync(ledger,'utf8').trim().split('\n').map(line=>JSON.parse(line));
  expect(attempts.filter(entry=>entry.id==='mail-collected')).toHaveLength(1);
  expect(attempts.filter(entry=>entry.id==='mail-collected-second'&&!entry.failed)).toHaveLength(1);
  writeFileSync(fault,JSON.stringify({blocked:[]}));await app.restartCoordinator();
  await expect.poll(async()=>{const recovered=await (await page.request.get(app.url+'/party-api/mail')).json();return {settings:recovered.settings,ids:recovered.messages.map((mail:any)=>mail.id).sort(),error:recovered.error,automationError:recovered.automationError};}).toEqual({settings:{autoCollect:false,autoDelete:true},ids:['mail-pending','mail-text','mail-unclaimed'],error:null,automationError:null});
  await info.attach('mailbox-delete-exception-recovery',{body:JSON.stringify({box,attempts,recovered:await (await page.request.get(app.url+'/party-api/mail')).json()}),contentType:'application/json'});
 });
 test('mailbox settings persist independently and delete only confirmed collected attachments',async({page,app},info)=>{
  await page.goto('/');
  await expect(page.getByLabel('New mail')).toBeVisible();
  await page.getByRole('button',{name:/^Mail/}).click();
  const dialog=page.getByRole('dialog',{name:'Mail',exact:true});
  await expect(page.getByLabel('New mail')).toHaveCount(0);
  const collect=dialog.getByLabel('Automatically collect mail attachments',{exact:true});
  const remove=dialog.getByLabel('Automatically delete messages after attachments are collected',{exact:true});
  await expect(collect).not.toBeChecked();await expect(remove).not.toBeChecked();
  await remove.click();await expect(remove).toBeChecked();
  await expect(dialog.getByRole('button',{name:/Collected attachment fixture/})).toHaveCount(0);
  await expect(dialog.getByRole('button',{name:/Unclaimed attachment fixture/})).toBeVisible();
  await expect(dialog.getByRole('button',{name:/Pending attachment fixture/})).toBeVisible();
  await expect(dialog.getByRole('button',{name:/Text message fixture/})).toBeVisible();
  await expect(collect).not.toBeChecked();
  await collect.click();await expect(collect).toBeChecked();
  await expect.poll(async()=>{const s=await app.state();return [s.merchantCurrent,...s.merchantQueue].filter(j=>j?.reason==='collect mail').map(j=>j.mail.id);}).toEqual(['mail-unclaimed']);
  await app.restartCoordinator();
  const response=await page.request.get(app.url+'/party-api/mail'),mailbox=await response.json();
  expect(mailbox.settings).toEqual({autoCollect:true,autoDelete:true});expect(mailbox.newCount).toBe(0);
  await info.attach('mailbox-automation-and-native-observations',{body:JSON.stringify(mailbox),contentType:'application/json'});
 });
 test('outbox shows durable sent records and deletion does not remove another sent message',async({page,app},info)=>{
  await page.goto('/');await page.getByRole('button',{name:/^Mail/}).click();
  const dialog=page.getByRole('dialog',{name:'Mail',exact:true});await dialog.getByRole('button',{name:'Outbox',exact:true}).click();
  await expect(dialog.getByText('Sent fixture one',{exact:true})).toBeVisible();await expect(dialog.getByText('Sent fixture two',{exact:true})).toBeVisible();
  await dialog.getByRole('button',{name:'Delete sent record Sent fixture one',exact:true}).click();
  await expect(dialog.getByText('Sent fixture one',{exact:true})).toHaveCount(0);await expect(dialog.getByText('Sent fixture two',{exact:true})).toBeVisible();
  await app.restartCoordinator();const mailbox=await (await page.request.get(app.url+'/party-api/mail')).json();
  expect(mailbox.outbox.map((m:any)=>m.id)).toEqual(['sent-fixture-2']);
  await info.attach('mailbox-outbox-after-restart',{body:JSON.stringify(mailbox),contentType:'application/json'});
 });
});
