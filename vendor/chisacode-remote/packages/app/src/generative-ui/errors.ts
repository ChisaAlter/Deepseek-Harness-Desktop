/**
 * 生成式 UI 错误类型与工具函数
 */

export type GenerativeUiErrorCode =
  | "CLIENT_UNAVAILABLE"
  | "RPC_TIMEOUT"
  | "RPC_REJECTED"
  | "INSTANCE_NOT_FOUND"
  | "AGENT_NOT_FOUND"
  | "PROPS_VALIDATION"
  | "COMPONENT_NOT_FOUND"
  | "ACTION_NOT_FOUND"
  | "COMPONENT_CRASH"
  | "SANDBOX_ERROR";

export class GenerativeUiError extends Error {
  constructor(
    message: string,
    public readonly code: GenerativeUiErrorCode,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "GenerativeUiError";
  }
}

/**
 * 根据错误码返回对应的中文错误消息
 */
export function toGenerativeUiErrorMessage(error: unknown): string {
  if (error instanceof GenerativeUiError) {
    switch (error.code) {
      case "CLIENT_UNAVAILABLE":
        return "连接已断开，操作未发送";
      case "RPC_TIMEOUT":
        return "操作超时，请重试";
      case "RPC_REJECTED":
        return "操作被服务器拒绝";
      case "INSTANCE_NOT_FOUND":
        return "组件实例未找到";
      case "AGENT_NOT_FOUND":
        return "智能体未找到";
      case "PROPS_VALIDATION":
        return "属性校验失败";
      case "COMPONENT_NOT_FOUND":
        return "组件未找到";
      case "COMPONENT_CRASH":
        return "组件渲染失败，正在重试";
      case "SANDBOX_ERROR":
        return "沙箱环境错误";
      default:
        return error.message;
    }
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "未知错误";
}

/**
 * 判断错误是否可恢复（无需弹出错误提示）
 */
export function isRecoverableGenUiError(error: unknown): boolean {
  if (error instanceof GenerativeUiError) {
    return ["CLIENT_UNAVAILABLE", "RPC_TIMEOUT"].includes(error.code);
  }
  return false;
}
