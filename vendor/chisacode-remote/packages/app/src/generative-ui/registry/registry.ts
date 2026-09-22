import { GenerativeUiError } from "@/generative-ui/errors";
import type { GenerativeUiComponentEntry, GenerativeUiComponentCategory, Platform } from "./types";

function appendShapeProps(lines: string[], shape: Record<string, unknown>): void {
  for (const [key, schema] of Object.entries(shape)) {
    const zodSchema = schema as {
      description?: string;
      _def?: { typeName?: string };
    };
    const typeName = zodSchema._def?.typeName ?? "unknown";
    const desc = zodSchema.description ? ` — ${zodSchema.description}` : "";
    lines.push(`  - \`${key}\` (${typeName})${desc}`);
  }
}

class GenerativeUiRegistry {
  private components = new Map<string, GenerativeUiComponentEntry>();

  register(id: string, entry: GenerativeUiComponentEntry): void {
    if (this.components.has(id)) {
      console.warn(`[GenUI] Overwriting existing component: ${id}`);
    }
    this.components.set(id, entry);
  }

  registerAll(entries: Record<string, GenerativeUiComponentEntry>): void {
    for (const [id, entry] of Object.entries(entries)) {
      this.register(id, entry);
    }
  }

  /** Clear all registered components. Intended for testing only. */
  clear(): void {
    this.components.clear();
  }

  get(id: string): GenerativeUiComponentEntry | null {
    return this.components.get(id) ?? null;
  }

  list(options?: {
    platform?: Platform;
    category?: GenerativeUiComponentCategory;
  }): { id: string; entry: GenerativeUiComponentEntry }[] {
    const result: { id: string; entry: GenerativeUiComponentEntry }[] = [];
    for (const [id, entry] of this.components) {
      if (options?.platform && entry.platforms && !entry.platforms.includes(options.platform)) {
        continue;
      }
      if (options?.category && entry.category !== options.category) {
        continue;
      }
      result.push({ id, entry });
    }
    return result;
  }

  /**
   * 校验 AI 提供的 props 是否符合组件的 Zod schema
   * 成功时返回合并后的 props（defaultProps + rawProps）
   * 失败时抛出 GenerativeUiError（PROPS_VALIDATION 或 COMPONENT_NOT_FOUND）
   */
  validateProps(componentId: string, rawProps: Record<string, unknown>): Record<string, unknown> {
    const entry = this.components.get(componentId);
    if (!entry) {
      throw new GenerativeUiError(`未知组件: ${componentId.slice(0, 128)}`, "COMPONENT_NOT_FOUND", {
        componentId,
      });
    }
    const merged = { ...entry.defaultProps, ...rawProps };
    const result = entry.propsSchema.safeParse(merged);
    if (!result.success) {
      throw new GenerativeUiError(
        `属性校验失败 ${componentId.slice(0, 128)}: ${result.error.message.slice(0, 128)}`,
        "PROPS_VALIDATION",
        { componentId, issues: result.error.issues },
      );
    }
    return result.data as Record<string, unknown>;
  }

  /**
   * 校验 action payload 是否符合组件 action schema
   */
  validateActionPayload(componentId: string, action: string, payload: unknown): void {
    const entry = this.components.get(componentId);
    if (!entry) {
      throw new GenerativeUiError("Component is not registered", "COMPONENT_NOT_FOUND", {
        componentId: componentId.slice(0, 128),
      });
    }

    const actionDef = entry.actions?.find((candidate) => candidate.name === action);
    if (!actionDef) {
      throw new GenerativeUiError("Action is not registered", "ACTION_NOT_FOUND", {
        componentId: componentId.slice(0, 128),
        action: action.slice(0, 128),
      });
    }

    const result = actionDef.payloadSchema.safeParse(payload);
    if (!result.success) {
      throw new GenerativeUiError("Action payload validation failed", "PROPS_VALIDATION", {
        componentId: componentId.slice(0, 128),
        action: action.slice(0, 128),
        issueCount: result.error.issues.length,
      });
    }
  }

  /**
   * 为给定平台生成 system prompt 文本，描述所有可用组件
   */
  generatePromptSection(platform?: Platform): string {
    const available = this.list(platform ? { platform } : undefined);
    if (available.length === 0) {
      return "";
    }

    const lines: string[] = [];
    lines.push("## 可用的生成式 UI 组件");
    lines.push("");
    lines.push(
      "你可以通过代码块创建交互式 UI 组件，格式为：",
      "",
      "```chisacode-ui component=<id>",
      '{ "prop1": "value1", ... }',
      "```",
      "",
      "可用组件列表：",
      "",
    );

    for (const { id, entry } of available) {
      lines.push(`### ${id}`);
      lines.push(`- 分类: ${entry.category}`);
      lines.push(`- 描述: ${entry.description}`);
      if (entry.actions && entry.actions.length > 0) {
        lines.push("- 可用操作:");
        for (const action of entry.actions) {
          lines.push(`  - \`${action.name}\`: ${action.description}`);
        }
      }
      if (entry.propsSchema) {
        try {
          const shape = (entry.propsSchema as { shape?: Record<string, unknown> }).shape;
          if (shape) {
            lines.push("- 属性:");
            appendShapeProps(lines, shape);
          }
        } catch {
          // schema introspection failed, skip
        }
      }
      lines.push("");
    }

    return lines.join("\n");
  }
}

export const genUiRegistry = new GenerativeUiRegistry();
