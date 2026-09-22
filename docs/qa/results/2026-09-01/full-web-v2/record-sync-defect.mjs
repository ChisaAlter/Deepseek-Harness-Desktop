import { record } from './lib.mjs';

const analysis = 'DEF-SYNC-REVERSE：桌面侧新建会话/重命名不会活推到已配对 SPA（60–90s 未到）。'
  + '桌面确有行（工作区菜单 aria 可见 NEW-002 桌面反向标记 ×2），SPA 重新配对后 baseline 能看到，'
  + '故 host/session-added 或 session/projection(非当前会话) 帧未到达 SPA（daemon mux 转发或 SPA 处理链待查）。'
  + '手机→桌面方向全部正常（rename/archive/fork/unlist 均 ≤30s）。违反 live-acceptance §0.7 SYNC 反向。';

record('LIST-003', 'Fail', analysis);
record('NEW-002', 'Fail', analysis);
record('MENU-002', 'Fail', `${analysis} 桌面改名对话框已确认但手机 30s 未跟随。`);
record('MENU-016', 'Fail', '=NEW-002（同一缺陷）');
console.log('recorded');
