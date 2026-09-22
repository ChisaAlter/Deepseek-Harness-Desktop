/**
 * Rewrites opaque Claude/gateway API error text into a clearer user-facing message.
 * Keeps the original text when no known pattern matches.
 * @param text Raw assistant/error text from Claude history or stream
 * @returns A more actionable message when recognized, otherwise the original text
 */
export function formatClaudeUserFacingErrorText(text: string): string {
  const normalized = text.trim();
  if (!normalized) {
    return text;
  }

  const accountProtection = matchAccountProtectionSchedulerError(normalized);
  if (accountProtection) {
    return accountProtection;
  }

  const invalidCredentials = matchInvalidCredentialsError(normalized);
  if (invalidCredentials) {
    return invalidCredentials;
  }

  const rateLimited = matchRateLimitError(normalized);
  if (rateLimited) {
    return rateLimited;
  }

  const genericApiError = matchGenericApiError(normalized);
  if (genericApiError) {
    return genericApiError;
  }

  return text;
}

function matchAccountProtectionSchedulerError(text: string): string | null {
  if (!/account protection scheduler is temporarily unavailable/i.test(text)) {
    return null;
  }
  const status = extractHttpStatus(text) ?? "503";
  const gatewayHint = extractGatewayHint(text);
  const lines = [
    `模型暂时不可用（HTTP ${status}）`,
    "",
    "原因：上游模型服务的账号保护调度器临时故障。",
    "建议：等 1–2 分钟后重试；如果一直失败，请到设置检查当前模型网关的上游地址/密钥。",
  ];
  if (gatewayHint) {
    lines.push(`本地转发入口：${gatewayHint}`);
  }
  return lines.join("\n");
}

function matchInvalidCredentialsError(text: string): string | null {
  if (
    !/invalid or expired credentials|incorrect api key|invalid api key|authentication_error|auth_kind=bearer/i.test(
      text,
    )
  ) {
    return null;
  }
  const status = extractHttpStatus(text) ?? "401";
  return [
    `模型鉴权失败（HTTP ${status}）`,
    "",
    "原因：当前模型网关密钥无效、过期，或上游拒绝了认证。",
    "建议：到设置打开对应模型网关，检查 API Key / 上游地址后重试。",
  ].join("\n");
}

function matchRateLimitError(text: string): string | null {
  if (!/\b429\b|rate limit|too many requests|quota/i.test(text)) {
    return null;
  }
  if (!/API Error|rate limit|too many requests|quota/i.test(text)) {
    return null;
  }
  const status = extractHttpStatus(text) ?? "429";
  return [
    `模型请求过于频繁（HTTP ${status}）`,
    "",
    "原因：上游限流或额度用尽。",
    "建议：稍后再试，或更换可用的模型/网关。",
  ].join("\n");
}

function matchGenericApiError(text: string): string | null {
  const match = text.match(/^API Error:\s*(\d{3})\s+([\s\S]+)$/i);
  if (!match) {
    return null;
  }
  const status = match[1] ?? "error";
  const detail = (match[2] ?? "").trim();
  if (!detail) {
    return null;
  }
  const gatewayHint = extractGatewayHint(text);
  const lines = [
    `模型请求失败（HTTP ${status}）`,
    "",
    `详情：${detail}`,
    "建议：稍后重试；若持续失败，请检查模型网关配置。",
  ];
  if (gatewayHint) {
    lines.push(`本地转发入口：${gatewayHint}`);
  }
  return lines.join("\n");
}

function extractHttpStatus(text: string): string | null {
  const apiError = text.match(/API Error:\s*(\d{3})\b/i);
  if (apiError?.[1]) {
    return apiError[1];
  }
  const bare = text.match(/\b(401|403|404|408|409|429|500|502|503|504)\b/);
  return bare?.[1] ?? null;
}

function extractGatewayHint(text: string): string | null {
  const match = text.match(/inference gateway\s*\(([^)]+)\)/i);
  const value = match?.[1]?.trim();
  return value && value.length > 0 ? value : null;
}
