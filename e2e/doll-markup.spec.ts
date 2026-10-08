import { test, expect } from './fixtures';
import { build } from 'esbuild';
import path from 'node:path';

// Failure modes: detached live parsing runs img handlers; portrait/comparison
// sinks execute event attributes; malformed/foreign markup breaks the allowlist;
// entity/control/CSS escape URLs bypass checks; valid native crop layers disappear.
// Render maintained components in a browser on the disposable gateway origin so
// an unsafe handler's same-origin control request is directly observable.
test('doll markup remains inert in portraits comparisons and map layer extraction', async ({page,app}, info) => {
  const bundle = await build({bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',
    tsconfig:path.resolve('dashboard/tsconfig.json'),stdin:{resolveDir:path.resolve('dashboard'),loader:'tsx',contents:`
      import React from 'react';import {createRoot} from 'react-dom/client';
      import {CharacterPortrait} from './features/party/character-portrait';
      import {GearComparisonDialog} from './features/party/gear-comparison-dialog';
      import {dollLayers} from './features/party/doll-layers';
      const root=createRoot(document.getElementById('root'));
      window.mountDolls=(html)=>{const character={name:'SecurityFixture',ctype:'warrior',level:80,hp:100,max_hp:100,mp:100,max_mp:100,
        attack:10,armor:10,resistance:10,str:10,dex:10,int:10,vit:10,frequency:1,speed:30,range:20,slots:{},items:[],characterDollHtml:html};
        root.render(<><section id="portrait" style={{position:'relative',width:80,height:100}}><CharacterPortrait html={html}/></section>
          <GearComparisonDialog comparison={{character,entry:{slot:0,item:{name:'helmet',level:0},meta:{definition:{type:'helmet',name:'Helmet',g:1},properties:{}}}}} onOpenChange={()=>{}}/></>);};
      window.inspectDollLayers=dollLayers;
    `}});
  const attacks: string[]=[];
  page.on('request',request=>{if(new URL(request.url()).pathname==='/party-api/doll-attack')attacks.push(request.url());});
  await page.route('**/doll-security-harness',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><div id="root"></div>'}));
  await page.route('**/native-doll.png',route=>route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=','base64')}));
  await page.goto(app.url+'/doll-security-harness');
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  const valid='<div class="native-doll" style="position:relative;width:54px;height:76px;overflow:hidden"><span style="position:absolute;left:3px;bottom:4px;width:24px;height:32px;overflow:hidden"><img src="/native-doll.png" width="96" height="128" style="width:96px;height:128px;margin-left:-24px;margin-top:-32px;image-rendering:pixelated"></span></div>';
  const handler="fetch('/party-api/doll-attack',{method:'POST'});window.dollAttack=true";
  const malicious=valid+`<img src="/missing-doll.png" onerror="${handler}"><svg onload="${handler}"><foreignObject><img src=x onerror="${handler}"></foreignObject></svg>`+
    `<iframe srcdoc="&lt;script&gt;parent.dollAttack=true&lt;/script&gt;"></iframe><script>${handler}</script>`+
    `<img src="&#106;avascript:alert(1)"><img src="//evil.invalid/a"><img src="data:image/svg+xml,bad">`+
    `<div style="background-image:u\\72l(javascript:alert(1));width:10px" onclick="${handler}"></div>`+
    `<span class="&quot; onmouseover=&quot;${handler}">breakout</span>`;
  await page.evaluate(html=>(window as any).mountDolls(html),malicious);
  await expect(page.locator('#portrait .native-doll')).toBeVisible();
  await expect(page.getByRole('dialog')).toBeVisible();
  const layers=await page.evaluate(html=>(window as any).inspectDollLayers(html),malicious);
  expect(layers[0]).toMatchObject({left:3,bottom:4,width:24,height:32,imageWidth:96,imageHeight:128,marginLeft:-24,marginTop:-32});
  expect(layers[0].url).toBe(app.url+'/native-doll.png');
  await expect(page.locator('#portrait img').first()).toHaveCSS('width','96px');
  await expect(page.locator('#root [onerror], [role="dialog"] [onerror], #root [onload], [role="dialog"] [onload], #root [onclick], [role="dialog"] [onclick], #root script, [role="dialog"] script, #root iframe, [role="dialog"] iframe, #root svg:not([class]), [role="dialog"] svg:not([class])')).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(await page.evaluate(()=>Boolean((window as any).dollAttack))).toBe(false);
  expect(attacks).toEqual([]);
  const unsafe=await page.locator('#root img, [role="dialog"] img').evaluateAll(images=>images.map(img=>img.getAttribute('src')).filter(src=>src&&/^(?:javascript:|data:|\/\/)/i.test(src)));
  expect(unsafe).toEqual([]);
  await info.attach('doll-sanitization-browser',{body:JSON.stringify({layers,attacks,unsafe,markup:await page.locator('#root').innerHTML()}),contentType:'application/json'});
  await info.attach('doll-sanitization-valid-crops',{body:await page.screenshot({fullPage:true}),contentType:'image/png'});
});
