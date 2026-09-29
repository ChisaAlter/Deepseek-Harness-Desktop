const {app,BrowserWindow,screen}=require('electron');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const exec=require('node:util').promisify(require('node:child_process').execFile);
const assert=require('node:assert/strict');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'native-border-probe-')));
app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{
 const stage=new BrowserWindow({...screen.getPrimaryDisplay().workArea,frame:false,focusable:false,skipTaskbar:true,backgroundColor:'#d020d0'});
 stage.setAlwaysOnTop(true,'screen-saver');
 await stage.loadURL('data:text/html,<body style="background:%23d020d0"></body>');stage.show();
 const win=new BrowserWindow({x:120,y:120,width:800,height:560,frame:false,transparent:true,roundedCorners:false,thickFrame:true,backgroundColor:'#00000000',show:false});
 require(path.join(process.cwd(),'src/main/native-window-motion')).enableNativeWindowMotion(win);
 const mode=process.argv.find(x=>x.startsWith('--mode='))?.slice(7)||'baseline';
 if(mode!=='baseline'){
  const k=require('koffi');const dwm=k.load('dwmapi.dll');
  const set=dwm.func('int __stdcall DwmSetWindowAttribute(uintptr_t h, uint attr, uint *value, uint size)');
  const h=win.getNativeWindowHandle().readBigUInt64LE();
  if(mode==='border-none') assert.equal(set(h,34,[0xfffffffe],4),0);
  if(mode==='nc-disabled') assert.equal(set(h,2,[1],4),0);
 }
 await win.loadURL('data:text/html,'+encodeURIComponent('<style>html,body{margin:0;height:100%;background:transparent;overflow:hidden}div{height:100%;border-radius:20px;background:#116699}</style><div></div>'));
 win.setAlwaysOnTop(true,'screen-saver');win.show();win.focus();await wait(700);
 const result=await exec('powershell.exe',['-NoProfile','-File',path.join(__dirname,'native-corners.ps1'),'-WindowHandle',String(win.getNativeWindowHandle().readBigUInt64LE()),'-OutputPath',path.join(__dirname,`native-border-${mode}.png`)],{windowsHide:true});
 const pixels=JSON.parse(result.stdout);fs.writeFileSync(path.join(__dirname,`native-border-${mode}.json`),JSON.stringify(pixels,null,2));
 console.log(mode,JSON.stringify(pixels));
 if(process.argv.includes('--record')){
  for(const [action,command] of [['maximize',3],['unmaximize',9],['minimize',6],['restore',9]]){
   await exec('powershell.exe',['-NoProfile','-File',path.join(__dirname,'capture.ps1'),'-WindowHandle',String(win.getNativeWindowHandle().readBigUInt64LE()),'-Action',String(command),'-OutputPath',path.join(__dirname,`nc-disabled-${action}.png`)],{windowsHide:true});
   console.log(action,win.isMaximized(),win.isMinimized());await wait(250);
  }
 }
 win.destroy();stage.destroy();assert.ok(pixels.every(x=>x.delta<=24),'native composed cutout must show backdrop without rectangular border/fill');app.exit(0);
}).catch(e=>{console.error(e);app.exit(1)});
