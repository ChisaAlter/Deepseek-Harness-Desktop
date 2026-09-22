import { describe, expect, it } from "vitest";
import { createAppI18n, resources } from "./index";

function flattenKeys(value: unknown, prefix = ""): string[] {
  if (!value || typeof value !== "object") {
    return prefix ? [prefix] : [];
  }

  return Object.entries(value).flatMap(([key, child]) =>
    flattenKeys(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe("createAppI18n", () => {
  it("defaults to Simplified Chinese", () => {
    const i18n = createAppI18n("zh-CN");

    expect(i18n.t("settings.general.language.title")).toBe("语言");
  });

  it("switches to English resources", () => {
    const i18n = createAppI18n("en");

    expect(i18n.t("settings.general.language.title")).toBe("Language");
  });

  it("uses the five product theme names in Chinese", () => {
    const i18n = createAppI18n("zh-CN");

    expect(i18n.t("settings.general.theme.options.light")).toBe("Soft Light");
    expect(i18n.t("settings.general.theme.options.dark")).toBe("Soft Dark");
    expect(i18n.t("settings.general.theme.options.liquid-neon")).toBe("Liquid Glass");
    expect(i18n.t("settings.general.theme.options.chisaki")).toBe("Chisaki");
    expect(i18n.t("settings.general.theme.options.aemeath")).toBe("Aemeath");
    expect(i18n.t("settings.general.theme.options.auto")).toBe("跟随系统");
  });

  it("uses the five product theme names in English", () => {
    const i18n = createAppI18n("en");

    expect(i18n.t("settings.general.theme.options.light")).toBe("Soft Light");
    expect(i18n.t("settings.general.theme.options.dark")).toBe("Soft Dark");
    expect(i18n.t("settings.general.theme.options.liquid-neon")).toBe("Liquid Glass");
    expect(i18n.t("settings.general.theme.options.chisaki")).toBe("Chisaki");
    expect(i18n.t("settings.general.theme.options.aemeath")).toBe("Aemeath");
    expect(i18n.t("settings.general.theme.options.auto")).toBe("System");
  });

  it("keeps the workbench environment labels aligned with the visual reference", () => {
    const i18n = createAppI18n("zh-CN");

    expect(i18n.t("workspace.environment.dockTabs.tasks")).toBe("Tasks");
    expect(i18n.t("workspace.environment.dockTabs.subagents")).toBe("Subagents");
    expect(i18n.t("workspace.environment.dockTabs.browser-context")).toBe("Browser");
    expect(i18n.t("workspace.reviewCallout.completedTitle")).toBe("Review completed work");
    expect(i18n.t("workspace.environment.changeSummary")).toBe(
      "已完成主题预览结构复核，可查看变更或继续提交。",
    );
    expect(i18n.t("workspace.environment.recentActivity")).toBe("最近活动");
  });

  it("uses the compact usage navigation label in Chinese", () => {
    expect(createAppI18n("zh-CN").t("settings.sections.usage")).toBe("用量");
  });

  it("labels the reasoning display setting in Chinese and English", () => {
    expect(createAppI18n("zh-CN").t("settings.general.showReasoning.title")).toBe("显示思考");
    expect(createAppI18n("en").t("settings.general.showReasoning.title")).toBe("Show reasoning");
  });

  it("falls back to English when a key is missing from the selected language", () => {
    const i18n = createAppI18n("zh-CN", {
      "zh-CN": {},
      en: {
        translation: {
          onlyEnglish: "English fallback",
        },
      },
    });

    expect(i18n.t("onlyEnglish")).toBe("English fallback");
  });

  it("keeps shared app translation domains available", () => {
    const zh = resources["zh-CN"].translation;
    const en = resources.en.translation;

    for (const domain of [
      "common",
      "onboarding",
      "workspace",
      "session",
      "composer",
      "terminal",
      "files",
      "providers",
      "settings",
      "errors",
    ]) {
      expect(zh).toHaveProperty(domain);
      expect(en).toHaveProperty(domain);
    }
  });

  it("keeps Simplified Chinese and English resource keys in sync", () => {
    const zhKeys = flattenKeys(resources["zh-CN"].translation).sort();
    const enKeys = flattenKeys(resources.en.translation).sort();

    expect(zhKeys).toEqual(enKeys);
  });

  it("returns Chinese for key desktop and web UI labels", () => {
    const i18n = createAppI18n("zh-CN");

    expect(i18n.t("workspace.title")).toBe("工作区");
    expect(i18n.t("workspace.newAgent")).toBe("新建智能体");
    expect(i18n.t("composer.placeholder")).toBe("输入消息...");
    expect(i18n.t("terminal.title")).toBe("终端");
    expect(i18n.t("providers.title")).toBe("提供商");
    expect(i18n.t("settings.title")).toBe("设置");
    expect(i18n.t("common.cancel")).toBe("取消");
    expect(i18n.t("common.confirm")).toBe("确认");
  });
});
