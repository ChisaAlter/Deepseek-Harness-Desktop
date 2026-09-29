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
 await stage.loadURL('data:text/html,<body style="background:%23d020d0"></body>');
 stage.show();
 for(const [name,factory,page] of [['main',factories.createMainWindow,'boot.html'],['launcher',factories.createLauncherWindow,'launcher.html']]){
  const win=factory();
  await win.loadFile(path.join(root,'src/renderer',page));
  win.setBounds({x:120,y:100,width:1060,height:720});win.show();win.focus();
  await wait(600);
  for(const [action,command] of [['maximize',3],['unmaximize',9],['minimize',6],['restore',9]]){
   const output=path.join(__dirname,`${name}-${action}.png`);
   await exec('powershell.exe',['-NoProfile','-File',path.join(__dirname,'capture.ps1'),'-WindowHandle',String(win.getNativeWindowHandle().readBigUInt64LE()),'-Action',String(command),'-OutputPath',output],{windowsHide:true});
   console.log(output); await wait(250);
  }
  win.destroy();
 }
 stage.destroy();app.exit(0);
}).catch(e=>{console.error(e);app.exit(1)});
