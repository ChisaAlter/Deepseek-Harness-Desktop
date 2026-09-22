// English translations (wecom area). Keys are exact Chinese literals passed to t().
export default {
  // Help text (wecom-bridge.mjs)
  '企业微信机器人已连接 DeepSeek Harness。': 'The Enterprise WeChat bot is connected to DeepSeek Harness.',

  // Bot replies and status text (wecom-bridge.mjs)

  '当前待处理图片较多，请稍后重新发送。': 'Too many images are pending. Please send them again later.',

  '结果文件「{name}」已生成，但企业微信智能机器人缺少素材上传或文件消息能力，请检查机器人权限。': 'The result file "{name}" was generated, but the Enterprise WeChat bot lacks media upload or file message capability. Please check the bot permissions.',
  '结果文件「{name}」超过当前企业微信机器人可发送的文件大小，未发送。': 'The result file "{name}" exceeds the file size this Enterprise WeChat bot can send and was not sent.',
  '结果文件「{name}」为空，企业微信不允许发送空文件。': 'The result file "{name}" is empty. Enterprise WeChat does not allow sending empty files.',
  '结果文件「{name}」暂时被企业微信限流，未能发送，请稍后重试。': 'The result file "{name}" was rate-limited by Enterprise WeChat and could not be sent. Please try again later.',
  '结果文件「{name}」已生成，但企业微信拒绝了该文件或文件消息。': 'The result file "{name}" was generated, but Enterprise WeChat rejected the file or file message.',
  '结果文件「{name}」已生成，但暂时未能通过企业微信发送，请稍后重试。': 'The result file "{name}" was generated but could not be sent via Enterprise WeChat right now. Please try again later.',
  '任务已完成，但没有生成可显示的文本。': 'The task completed, but no displayable text was generated.',
  '目前支持文字、图片和语音转写消息。': 'Currently only text, images, and voice transcription messages are supported.',
  '企业微信机器人与 DeepSeek Harness 连接正常。': 'The connection between the Enterprise WeChat bot and DeepSeek Harness is working.',
  '正在思考中…': 'Thinking…',
  '企业微信交互问题发送失败。': 'Failed to send the Enterprise WeChat interaction question.',

  // Provisioning, status, and errors (wecom-controller.mjs)
  '企业微信机器人凭据缺失，请移除后重新扫码。': 'The Enterprise WeChat bot credentials are missing. Please remove the bot and scan the QR code again.',
  '企业微信连接未就绪，插件会自动重试。': 'The Enterprise WeChat connection is not ready. The plugin will retry automatically.',
  '扫码绑定已取消。': 'QR code binding has been cancelled.',
  '无法生成企业微信二维码，请稍后重试。': 'Unable to generate the Enterprise WeChat QR code. Please try again later.',
  '企业微信二维码已过期，请重新生成。': 'The Enterprise WeChat QR code has expired. Please generate a new one.',
  '企业微信机器人已绑定，消息连接暂未就绪。': 'The Enterprise WeChat bot is bound, but the message connection is not ready yet.',
  '企业微信连接仍未就绪，请稍后重试。': 'The Enterprise WeChat connection is still not ready. Please try again later.',
  '企业微信扫码没有完成，请重新生成二维码。': 'The Enterprise WeChat QR scan was not completed. Please generate a new QR code.',
  '企业微信扫码服务暂时不可用，请重新生成二维码。': 'The Enterprise WeChat QR service is temporarily unavailable. Please generate a new QR code.',
  '企业微信已授权，但无法安全保存接入配置。': 'Enterprise WeChat authorization succeeded, but the connection configuration could not be saved safely.',
  '企业微信机器人': 'Enterprise WeChat bot',
  '企业微信机器人（{botId}）': 'Enterprise WeChat bot ({botId})',
  '企业微信 WebSocket 长连接运行正常': 'The Enterprise WeChat WebSocket long connection is running normally',
  '企业微信连接未就绪，插件会自动重试': 'The Enterprise WeChat connection is not ready. The plugin will retry automatically',
  '企业微信连接当前离线': 'The Enterprise WeChat connection is currently offline',
};
