import * as React from 'react';

import { h, isEnglish } from './i18n.js';

function messageErrorTime(value) {
  try {
    return new Intl.DateTimeFormat(isEnglish() ? 'en-US' : 'zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value));
  } catch {
    return null;
  }
}

export function ChannelListHeading({ className = '', id, title, connectionLabel }) {
  const helpId = React.useId();
  return h('div', { className: `${className} dim-listHeading`.trim() },
    h('div', { className: 'dim-listTitle' },
      h('h3', id ? { id } : null, title),
      h('span', { className: 'dim-channelHelp' },
        h('button', {
          type: 'button',
          className: 'dim-channelHelpButton',
          'aria-label': '查看消息通道说明',
          'aria-describedby': helpId,
        }, h('span', { 'aria-hidden': 'true' }, '?')),
        h('span', {
          id: helpId,
          className: 'dim-channelTooltip',
          role: 'tooltip',
        },
        h('span', null, '消息通道'),
        h('strong', null, connectionLabel)))));
}

export function BotStatusMeta({
  className = '',
  dotClassName = '',
  tone,
  stateLabel,
  lastCheckedAt,
  formatCheckedTime,
  healthState,
}) {
  return h('div', { className: 'dim-botHealthGroup' },
    h('div', {
      className: `${className} dim-botHealth`.trim(),
      ...(healthState ? { 'data-health': healthState } : {}),
    },
    h('span', {
      className: `${dotClassName} dim-healthDot`.trim(),
      'data-tone': tone,
    }),
    h('span', null, stateLabel)),
    h('div', { className: 'dim-lastChecked' },
      h('span', null, '最近检查'),
      h('span', null, formatCheckedTime(lastCheckedAt))));
}

export function LastMessageErrorSummary({ className = '', error }) {
  if (!error) return null;
  const occurredAt = messageErrorTime(error.at);
  return h('div', {
    className: `${className} dim-cardSummary`.trim(),
    role: 'status',
  },
  h('strong', null, '最近一条消息处理失败'),
  '：',
  h('span', null, error.message),
  '（',
  h('span', null, '错误码'),
  ` ${error.code} · `,
  h('span', null, '参考号'),
  ` ${error.referenceId}`,
  occurredAt ? h(React.Fragment, null,
    ' · ',
    h('time', { dateTime: new Date(error.at).toISOString() }, occurredAt)) : null,
  '）');
}
