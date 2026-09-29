const { app, BrowserWindow, screen } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { promisify } = require('node:util');
const exec = promisify(require('node:child_process').execFile);
const root = process.cwd();
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-motion-film-')));
app.on('window-all-closed', () => {});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{
 const factories=require(path.join(root,'src/main/window'));
 const stage=new BrowserWindow({frame:false,backgroundColor:'#d020d0',...screen.getPrimaryDisplay().workArea,focusable:false,skipTaskbar:true});
 stage.setAlwaysOnTop(true,'screen-saver');
 await stage.loadURL('data:text/html,<body style="background:%23d020d0"></body>');
 stage.show();
 for(const [name,factory,page] of [['main',factories.createMainWindow,'boot.html'],['launcher',factories.createLauncherWindow,'launcher.html']]){
  const win=factory();
  win.setAlwaysOnTop(true,'screen-saver');
  await win.loadFile(path.join(root,'src/renderer',page));
  win.setBounds({x:120,y:100,width:1060,height:720});win.show();win.focus();
  await wait(600);
  for(const [action,command] of [['maximize',3],['unmaximize',9],['minimize',6],['restore',9]]){
   const output=path.join(__dirname,`${name}-${action}.png`);
   const trigger=path.join(app.getPath('userData'),`${name}-${action}.ready`);
   const recording=exec('powershell.exe',['-NoProfile','-File',path.join(__dirname,'capture.ps1'),'-WindowHandle',String(win.getNativeWindowHandle().readBigUInt64LE()),'-Action',String(command),'-OutputPath',output,'-TriggerPath',trigger],{windowsHide:true});
   const deadline=Date.now()+10000;
   while(!fs.existsSync(trigger)&&Date.now()<deadline) await wait(10);
   if(!fs.existsSync(trigger)) throw Error('Capture did not become ready');
   if(action==='restore') win.restore();
   else await win.webContents.executeJavaScript(`window.shell.windowAction('${action==='unmaximize'?'maximize':action}')`);
   await recording;
   console.log(output); await wait(250);
  }
  win.destroy();
 }
 stage.destroy();app.exit(0);
}).catch(e=>{console.error(e);app.exit(1)});
