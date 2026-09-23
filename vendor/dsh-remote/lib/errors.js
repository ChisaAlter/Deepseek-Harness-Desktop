// dsh-remote — SSH/SFTP error classification → actionable hints.
// Pure function so it is unit-testable and reused by tools, slash commands,
// the test-connect route and the settings UI.

/** Classify an error thrown by the ssh pool / sftp wrapper.
 * @returns {{ category: 'auth'|'network'|'hostkey'|'timeout'|'sftp'|'credentials'|'other', hint: string, raw: string }}
 */
export function classifyError(err, opts = {}) {
  const msg = String((err && err.message) || err || '')
  const { host, port } = opts
  const where = host ? ` (${host}:${port || 22})` : ''

  if (/host key/i.test(msg) && /(change|mismatch|fingerprint|verify|unknown host)/i.test(msg)) {
    return {
      category: 'hostkey',
      hint: `主机指纹校验失败${where}：可能遭遇中间人攻击，或该主机重装/更换过密钥。确认无异常后执行 /remote-forget-key 重新信任。`,
      raw: msg,
    }
  }
  if (/permission denied|all configured authentication methods failed|authentication failed/i.test(msg)) {
    return {
      category: 'auth',
      hint: `认证失败${where}：检查用户名/密码/私钥路径，私钥是否设了 passphrase；若公司机器要求 OTP/动态码，请确认机器配置了 keyboard-interactive 或对应密码。`,
      raw: msg,
    }
  }
  if (/no credentials/i.test(msg)) {
    return {
      category: 'credentials',
      hint: `缺少凭据：请设置 password 或 privateKeyPath（私钥只在显式提供时使用），或为该机器启用 SSH agent。`,
      raw: msg,
    }
  }
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(msg)) {
    return {
      category: 'network',
      hint: `主机不可达${where}：检查 host 拼写 / IP / DNS；内网机器可能需要走跳板机（配置 proxy）或 VPN。`,
      raw: msg,
    }
  }
  if (/ECONNREFUSED|connection refused/i.test(msg)) {
    return {
      category: 'network',
      hint: `连接被拒绝${where}：确认端口 ${port || 22} 正确、远端 sshd 在监听；检查防火墙/安全组是否放行。`,
      raw: msg,
    }
  }
  if (/sftp operation timed out|sftp failed|readdir|writeFile|fastGet|fastPut/i.test(msg)) {
    return {
      category: 'sftp',
      hint: `SFTP 操作失败：可能是远端磁盘/权限问题或服务器卡死（已自动超时保护）。检查目标路径权限。`,
      raw: msg,
    }
  }
  if (/ETIMEDOUT|timed out|timeout/i.test(msg)) {
    return {
      category: 'timeout',
      hint: `连接/操作超时${where}：检查端口、防火墙、路由；或调大 connectTimeoutMs / commandTimeoutMs。`,
      raw: msg,
    }
  }
  if (/cannot read private key/i.test(msg)) {
    return {
      category: 'credentials',
      hint: `无法读取私钥文件：检查 privateKeyPath 是否存在、当前用户是否有读取权限。`,
      raw: msg,
    }
  }
  return { category: 'other', hint: msg, raw: msg }
}

/** One-line friendly message: hint (+ raw when it adds information). */
export function friendlyMessage(err, opts = {}) {
  const c = classifyError(err, opts)
  if (c.category === 'other') return c.raw
  if (c.raw && c.raw !== c.hint) return `${c.hint}（原始错误：${c.raw}）`
  return c.hint
}
