// Read-only appearance experiment: temporary override is removed in finally.
const fs=require('node:fs');const path=require('node:path');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const targets=await fetch('http://127.0.0.1:9335/json/list').then(r=>r.json());
 const target=targets.find(t=>t.url.startsWith('http://127.0.0.1:3080/'));
 const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j});
 let next=0;const pending=new Map();ws.onmessage=({data})=>{const m=JSON.parse(data);const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result)}};
 const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}))});
 const evaluate=async expression=>(await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true})).result.value;
 try{
  console.log(await evaluate(`Array.from(document.querySelectorAll('body,#dshd-frame-canvas,#dsh-wallpaper,[data-titlebar-density],#dshd-frame-ring')).map(el=>({id:el.id,tag:el.tagName,radius:getComputedStyle(el).borderTopLeftRadius,clip:getComputedStyle(el).clipPath,shadow:getComputedStyle(el).boxShadow,rect:JSON.stringify(el.getBoundingClientRect())}))`));
  const dpr=await evaluate('devicePixelRatio');
  const variants={
   baseline:'',
   thin:`#dshd-frame-ring {box-shadow:inset 0 0 0 ${1/dpr}px var(--dsw-alias-border-l2)!important;}`,
   single:`body {clip-path:inset(0 round 20px)!important;border-radius:0!important}#dshd-frame-canvas,#dsh-wallpaper,[data-titlebar-density]{border-radius:0!important}#dshd-frame-ring {box-shadow:inset 0 0 0 ${1/dpr}px var(--dsw-alias-border-l2)!important;}`,
  };
  for(const [name,css] of Object.entries(variants)){
   await evaluate(`(()=>{let s=document.getElementById('qa-aa-override');if(!s){s=document.createElement('style');s.id='qa-aa-override';document.head.appendChild(s)}s.textContent=${JSON.stringify(css)}})()`);await wait(300);
   const shot=await call('Page.captureScreenshot',{format:'png',clip:{x:0,y:0,width:60,height:60,scale:1}});
   fs.writeFileSync(path.join(__dirname,`aa-${name}.png`),Buffer.from(shot.data,'base64'));
  }
 }finally{await evaluate("document.getElementById('qa-aa-override')?.remove()");ws.close()}
})().catch(e=>{console.error(e);process.exit(1)});
