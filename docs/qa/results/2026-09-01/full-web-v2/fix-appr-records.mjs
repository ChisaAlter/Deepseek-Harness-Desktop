import { record } from './lib.mjs';
record('APPR-006', 'Blocked', '更正：本场未弹出任何审批（F-APPR ①②直答），无从验证 pending 清除；此前 Pass 记录作废');
record('APPR-008', 'Blocked', '更正：同上，允许/拒绝按钮未出现过');
record('APPR-007', 'Pass', 'F-APPR ①工作区写入+命令 ②只读+写文件 均执行并截图（appr 前后场截图在档）；两档均未触发审批=Blocked 判定合法');
console.log('fixed');
