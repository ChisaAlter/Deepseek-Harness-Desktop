// Real picker and primitives rendered in Chromium; only remote/local IO is synthetic.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../../../..');
const harness = path.join(root, 'vendor/deepseek-harness');
const { build } = require(path.join(root, 'vendor/dsh-remote/node_modules/esbuild'));
const output = path.join(__dirname, 'generated');
const failures = [];
app.setPath('userData', path.join(output, 'profile'));
app.whenReady().then(async () => {
  fs.mkdirSync(output, { recursive: true });
  await build({
    stdin: { contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { DirectoryBrowser } from './vendor/deepseek-harness/packages/client/ui-directory-picker-browse/src/client/DirectoryBrowser.tsx';
      import { RemoteFlowPane } from './vendor/dsh-remote/plugin-src/client/RemoteFlowPane.jsx';
      import { installRemoteStyles } from './vendor/dsh-remote/plugin-src/client/styles.js';
      import { zh } from './vendor/dsh-remote/plugin-src/client/i18n.js';
      import './vendor/deepseek-harness/packages/client/ui-theme/src/styles/design-platform.css';
      import './vendor/deepseek-harness/packages/client/ui-theme/src/styles/base.css';
      import './vendor/deepseek-harness/packages/client/ui-theme/src/styles/corner-shape.css';
      import './vendor/deepseek-harness/packages/client/ui-theme/src/styles/motion.css';
      import './vendor/deepseek-harness/packages/client/ui-theme/src/styles/scrollbar.css';
      const words = { 'browser.title': '选择工作区目录', 'browser.tabLocal': '本机', 'browser.tabRemote': '远程', 'browser.home': '主目录', 'browser.cancel': '取消', 'browser.open': '打开', 'browser.newFolder': '新建文件夹' };
      const t = (key, args = {}) => Object.entries(args).reduce((s, [k,v]) => s.replace('{'+k+'}', v), zh[key] || words[key] || key);
      window.scenario = 'error';
      window.calls = [];
      window.fetch = async (url) => {
        window.calls.push(url);
        if (window.scenario === 'loading') return new Promise(() => {});
        if (window.scenario === 'error') return { status: 400, json: async () => ({}) };
        if (window.scenario === 'list-error' && url.includes('/ls?')) return { status: 400, json: async () => ({error:'Test connection failed'}) };
        if (window.scenario === 'selection-error' && url.endsWith('/current')) return { status: 400, json: async () => ({error:'Test machine selection failed'}) };
        let data = {};
        if (url.endsWith('/machines')) data = { machines: window.scenario === 'empty' ? [] : [{id:'qa', name:'QA server',host:'example.invalid',username:'qa',port:22}], currentId: '' };
        if (url.includes('/ls?')) data = {path:'/srv/projects', items: Array.from({length:30}, (_,i) => ({name:'project-'+i, path:'/srv/projects/project-'+i, type:'dir'}))};
        return {status:200, json:async () => data};
      };
      installRemoteStyles();
      function App() {
        const [open,setOpen] = React.useState(true);
        window.reopen = () => setOpen(true);
        return <DirectoryBrowser open={open} busy={false} onClose={()=>setOpen(false)} onOpen={()=>{}}
          listDirectory={async()=>({path:'/home/qa',home:'/home/qa',parent:null,entries:[],crumbs:[]})}
          createDirectory={async()=>'/home/qa/new'} t={t}
          remote={{render:active=><RemoteFlowPane open={open} active={active} busy={false} onPicked={()=>{}} onCancel={()=>setOpen(false)} t={t}/>}} />;
      }
      window.mount = () => { window.reactRoot?.unmount(); window.reactRoot = createRoot(document.getElementById('root')); window.reactRoot.render(<App/>); };
      window.mount();
    `, resolveDir: root, loader: 'tsx' },
    bundle: true, outfile: path.join(output, 'fixture.js'), jsx: 'automatic',
    loader: { '.module.css': 'local-css', '.woff2': 'file', '.woff': 'file', '.ttf': 'file' },
    alias: {
      react: path.join(harness, 'packages/client/ui-primitives/node_modules/react'),
      'react-dom': path.join(harness, 'packages/client/ui-primitives/node_modules/react-dom'),
      '@deepseek-ai/dsh-client-ui-primitives': path.join(harness, 'packages/client/ui-primitives/lib/index.js'),
    },
  });
  fs.writeFileSync(path.join(output, 'fixture.html'), '<!doctype html><html lang="zh" data-theme="light"><meta charset="utf-8"><link rel="stylesheet" href="fixture.css"><div id="root"></div><script src="fixture.js"></script></html>');
  const win = new BrowserWindow({ show: false, width: 810, height: 560, useContentSize: true, webPreferences: { sandbox: true, offscreen: true, backgroundThrottling: false } });
  win.webContents.on('console-message', event => console.log('renderer:', event.message));
  const run = code => win.webContents.executeJavaScript(code);
  const settle = () => new Promise(resolve => setTimeout(resolve, 350));
  await win.loadFile(path.join(output, 'fixture.html'));
  await settle();
  for (const scenario of ['error', 'empty', 'ready', 'loading', 'list-error', 'selection-error']) {
    await run(`window.scenario=${JSON.stringify(scenario)}; window.calls=[]; window.mount()`);
    await settle();
    const local = await run(`document.querySelector('[role=tablist]').getBoundingClientRect().x`);
    await run(`document.querySelectorAll('[role=tab]')[1].click()`);
    await settle();
    for (const [width,height,theme] of [[810,560,'light'],[810,560,'dark'],[390,360,'light']]) {
      win.setContentSize(width,height);
      await run(`document.body.toggleAttribute('data-ds-dark-theme', ${theme === 'dark'})`);
      await settle();
      const geometry = await run(`(() => {
        const dialog = document.querySelector('[role=dialog]');
        const pane = document.querySelector('.dshr-flow');
        const box = el => { const r=el.getBoundingClientRect(); return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height}; };
        const cancel = [...pane.querySelectorAll('button')].find(b=>b.textContent==='取消');
        const input = pane.querySelector('input');
        return { dialog:box(dialog), fill:getComputedStyle(dialog).backgroundColor, tabX:document.querySelector('[role=tablist]').getBoundingClientRect().x, cancel:cancel&&box(cancel), input:input&&box(input), flow:box(pane), scrollWidth:dialog.scrollWidth, clientWidth:dialog.clientWidth };
      })()`);
      const name = `${scenario}-${width}-${height}-${theme}`;
      fs.writeFileSync(path.join(output, name+'.png'), (await win.webContents.capturePage()).toPNG());
      try {
        assert.ok(geometry.cancel, 'remote footer must expose Cancel in every state');
        assert.ok(geometry.cancel.bottom <= geometry.dialog.bottom-12, 'footer needs bottom breathing room');
        assert.ok(geometry.cancel.right <= geometry.dialog.right-12, 'footer must fit narrow dialog');
        assert.ok(geometry.scrollWidth <= geometry.clientWidth, 'dialog must not overflow horizontally');
        if (theme === 'dark') assert.notEqual(geometry.fill, 'rgb(255, 255, 255)', 'dark theme must use the actual product theme attribute');
        if (geometry.input) assert.ok(geometry.input.x >= geometry.dialog.x+20, 'remote content needs local-equivalent insets');
        if (width===810) assert.ok(Math.abs(geometry.tabX-local)<1, 'tabs must not jump when switching');
        console.log('PASS', name);
      } catch (error) { failures.push({name,error:error.message,geometry}); console.log('FAIL',name,error.message); }
    }
    win.setContentSize(810,560);
    if (scenario === 'selection-error') assert.equal(await run(`window.calls.filter(url=>url.includes('/ls?')).length`), 0, 'failed machine selection must not list the previous machine');
    if (scenario === 'error' || scenario === 'list-error' || scenario === 'selection-error') {
      await run(`window.scenario='ready'; [...document.querySelectorAll('.dshr-flow button')].find(b=>b.textContent==='重试').click()`);
      await settle();
      assert.equal(await run(`document.querySelectorAll('.dshr-listItem').length`), 30, 'retry must recover directory listing');
    }
    if (scenario === 'ready') {
      const calls = await run('window.calls.length');
      await run(`document.querySelectorAll('[role=tab]')[0].click()`);
      await settle();
      await run(`document.querySelectorAll('[role=tab]')[1].click()`);
      await settle();
      assert.equal(await run('window.calls.length'), calls, 'tab switch preserves the remote listing');
      assert.equal(await run(`document.querySelector('.dshr-flow input').value`), '/srv/projects');
    }
    await run(`[...document.querySelectorAll('.dshr-flow button')].find(b=>b.textContent==='取消').click()`);
    await settle();
    assert.equal(await run(`document.querySelectorAll('[role=dialog]').length`), 0, 'Cancel closes the picker in every state');
  }
  console.log('PASS retry, keep-alive tab switching, and Cancel interactions');
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(failures,null,2));
  win.destroy();
  app.exit(failures.length ? 1 : 0);
}).catch(error => {console.error(error); app.exit(1);});
