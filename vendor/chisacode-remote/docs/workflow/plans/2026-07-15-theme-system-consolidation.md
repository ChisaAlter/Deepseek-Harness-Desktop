# 主题系统收口实施计划

> **面向执行代理：** 必须使用 `workflow:subagent-driven-development`（推荐）或
> `workflow:executing-plans`，按任务逐项实施。所有步骤使用复选框跟踪。

**目标：** Electron 桌面端和 Android 端统一使用“跟随系统 + 五套产品主题”，新安装默认
Blockchain Light，并把四套旧暗色主题平滑迁移到 Cyber Dark。

**架构：** `packages/app/src/styles/theme.ts` 成为主题目录、排序、迁移和预览元数据的唯一权威。
设置存储在读取边界归一化旧值；设置菜单和快捷键循环只消费统一常量。保留五套现役主题的内部
标识符，删除旧主题的运行时注册和用户入口。

**技术栈：** TypeScript、React Native、Expo、Electron、react-native-unistyles、Vitest、i18next。

## 全局约束

- 仅支持 Electron 桌面端和 Android，不增加 iOS 工作。
- 默认主题必须是 `light`（Blockchain Light）。
- 固定主题顺序必须是 `light`、`dark`、`liquid-neon`、`chisaki`、`aemeath`。
- 设置菜单顺序必须是 `auto`，随后五套固定主题。
- `zinc`、`midnight`、`claude`、`ghostty` 只能作为历史存储输入，读取后迁移为 `dark`。
- Android 与 Electron 使用相同主题目录；Android 兜底主题必须是 `light`。
- 不修改协议 schema、daemon 状态、组件布局或语法高亮主题。
- 测试禁止固定等待；只运行目标 Vitest 文件，不运行完整测试套件。
- 视觉验收必须分别使用真实 Electron 和 Android 设备或模拟器。

---

### Task 1：建立唯一的五主题权威

**文件：**

- 修改：`packages/app/src/styles/theme.test.ts`
- 修改：`packages/app/src/styles/theme.ts`
- 修改：`packages/app/src/styles/unistyles.ts`
- 修改：`packages/app/src/app/_layout/AppContainer.tsx`
- 修改：`packages/app/src/screens/settings-screen.tsx`
- 修改：`packages/app/src/hooks/use-settings/storage.test.ts`

**接口：**

- 产出：`ACTIVE_THEME_NAMES: readonly ["light", "dark", "liquid-neon", "chisaki", "aemeath"]`
- 产出：`THEME_PICKER_OPTIONS: readonly ["auto", ...typeof ACTIVE_THEME_NAMES]`
- 产出：`LEGACY_THEME_MIGRATIONS: Readonly<Record<LegacyThemeName, ActiveThemeName>>`
- 产出：`ANDROID_THEME_OPTIONS`，与 `THEME_PICKER_OPTIONS` 使用同一目录
- 产出：`ANDROID_FALLBACK_THEME: "light"`

- [ ] **步骤 1：先写主题目录失败测试**

在 `packages/app/src/styles/theme.test.ts` 导入新增常量，并增加：

```typescript
describe("theme catalog", () => {
  it("exposes exactly the five product themes in product order", () => {
    expect(ACTIVE_THEME_NAMES).toEqual(["light", "dark", "liquid-neon", "chisaki", "aemeath"]);
    expect(THEME_PICKER_OPTIONS).toEqual(["auto", ...ACTIVE_THEME_NAMES]);
  });

  it("shares the complete catalog with Android and defaults Android to light", () => {
    expect(ANDROID_THEME_OPTIONS).toEqual(THEME_PICKER_OPTIONS);
    expect(ANDROID_FALLBACK_THEME).toBe("light");
  });

  it("maps every legacy dark theme to cyber dark", () => {
    expect(LEGACY_THEME_MIGRATIONS).toEqual({
      zinc: "dark",
      midnight: "dark",
      claude: "dark",
      ghostty: "dark",
    });
  });

  it("registers runtime mappings only for active product themes", () => {
    expect(Object.keys(THEME_TO_UNISTYLES)).toEqual(ACTIVE_THEME_NAMES);
  });
});
```

- [ ] **步骤 2：运行测试并确认按预期失败**

运行：

```powershell
npx vitest run packages/app/src/styles/theme.test.ts --bail=1
```

预期：失败，提示新增目录常量尚未导出，或当前 Android 默认仍为 `liquid-neon`。

- [ ] **步骤 3：实现五主题目录并删除旧运行时主题**

在 `packages/app/src/styles/theme.ts` 中使用以下定义替换分散的主题联合与 Android 数组：

```typescript
export const ACTIVE_THEME_NAMES = ["light", "dark", "liquid-neon", "chisaki", "aemeath"] as const;

export type ActiveThemeName = (typeof ACTIVE_THEME_NAMES)[number];
export type ThemeName = ActiveThemeName;

export const THEME_PICKER_OPTIONS = ["auto", ...ACTIVE_THEME_NAMES] as const;

export const LEGACY_THEME_MIGRATIONS = {
  zinc: "dark",
  midnight: "dark",
  claude: "dark",
  ghostty: "dark",
} as const satisfies Record<string, ActiveThemeName>;

export type LegacyThemeName = keyof typeof LEGACY_THEME_MIGRATIONS;

export const ANDROID_THEME_OPTIONS = THEME_PICKER_OPTIONS;
export const ANDROID_FALLBACK_THEME: ActiveThemeName = "light";
```

删除 `zincDarkColors`、`midnightDarkColors`、`claudeDarkColors`、`ghosttyDarkColors` 及对应
`dark*Theme` 导出、预览和 swatch。`THEME_TO_UNISTYLES` 仅保留五套现役主题。

在 `packages/app/src/styles/unistyles.ts` 删除四套旧主题导入、注册和类型声明。

因为 `ThemeName` 会在本任务中立即收窄，必须在同一个可编译提交内同步迁移现有消费者：

- `AppContainer.tsx` 让 `THEME_CYCLE_ORDER` 直接使用 `ACTIVE_THEME_NAMES`；
- `settings-screen.tsx` 让主题菜单直接遍历 `THEME_PICKER_OPTIONS`，删除旧主题数组、Android
  分支、分隔线及对应无用导入；
- `storage.test.ts` 删除主动保存 `ghostty` 的旧测试，因为旧主题只允许作为历史存储输入。

这三个改动只消除类型收窄产生的即时编译回归；默认值、存储迁移和主题名称仍分别留给 Task 2
和 Task 3。

- [ ] **步骤 4：运行主题测试确认转绿**

运行：

```powershell
npx vitest run packages/app/src/styles/theme.test.ts --bail=1
```

预期：该文件全部测试通过，0 个失败。

- [ ] **步骤 5：提交任务一**

```powershell
git add -- packages/app/src/styles/theme.ts packages/app/src/styles/theme.test.ts packages/app/src/styles/unistyles.ts
git commit -m "refactor(app): consolidate active theme catalog"
```

---

### Task 2：迁移默认值、历史设置和 Android 策略

**文件：**

- 修改：`packages/app/src/hooks/use-settings/storage.test.ts`
- 修改：`packages/app/src/hooks/use-settings/storage.ts`
- 检查：`packages/app/src/hooks/use-settings/index.ts`

**接口：**

- 消费：任务一导出的 `ACTIVE_THEME_NAMES`、`THEME_PICKER_OPTIONS`、
  `LEGACY_THEME_MIGRATIONS`、`ANDROID_THEME_OPTIONS` 和 `ANDROID_FALLBACK_THEME`
- 行为：`AppSettings["theme"]` 只允许五套现役主题或 `auto`
- 行为：历史主题字符串在存储边界迁移为 `dark`

- [ ] **步骤 1：把存储测试改成目标行为并增加历史迁移覆盖**

在 `packages/app/src/hooks/use-settings/storage.test.ts`：

```typescript
const androidThemePolicy = {
  allowedThemes: new Set(ANDROID_THEME_OPTIONS),
  fallbackTheme: ANDROID_FALLBACK_THEME,
};

it("defaults theme to blockchain light when storage is empty", async () => {
  const result = await loadAppSettingsFromStorage(makeDeps());
  expect(result.theme).toBe("light");
});

it.each(["zinc", "midnight", "claude", "ghostty"])(
  "migrates legacy %s theme to cyber dark and rewrites storage",
  async (legacyTheme) => {
    const deps = makeDeps({
      storage: createInMemoryKeyValueStorage({
        [APP_SETTINGS_KEY]: JSON.stringify({ theme: legacyTheme }),
      }),
    });

    const result = await loadAppSettingsFromStorage(deps);

    expect(result.theme).toBe("dark");
    expect(deps.storage.entries.get(APP_SETTINGS_KEY)).toBe(JSON.stringify(result));
  },
);

it.each(THEME_PICKER_OPTIONS)("keeps the active %s theme", async (theme) => {
  const deps = makeDeps({
    ...androidThemePolicy,
    storage: createInMemoryKeyValueStorage({
      [APP_SETTINGS_KEY]: JSON.stringify({ theme }),
    }),
  });

  const result = await loadAppSettingsFromStorage(deps);
  expect(result.theme).toBe(theme);
});
```

删除“Android system theme 迁移到玻璃”“不允许主题兜底为玻璃”等旧断言。删除主动保存
`ghostty` 的测试：任务一后旧主题不再属于 `AppSettings["theme"]`，只能从历史存储输入进入
迁移路径。

- [ ] **步骤 2：运行存储测试并确认按预期失败**

运行：

```powershell
npx vitest run packages/app/src/hooks/use-settings/storage.test.ts --bail=1
```

预期：默认主题、历史迁移或 Android 主题保留测试失败。

- [ ] **步骤 3：实现设置归一化**

在 `packages/app/src/hooks/use-settings/storage.ts`：

```typescript
const VALID_THEMES = new Set<string>(THEME_PICKER_OPTIONS);
const LEGACY_THEMES = new Set<string>(Object.keys(LEGACY_THEME_MIGRATIONS));

export const DEFAULT_CLIENT_SETTINGS: AppSettings = {
  theme: "light",
  language: "zh-CN",
  sendBehavior: "interrupt",
  serviceUrlBehavior: "ask",
  terminalScrollbackLines: DEFAULT_TERMINAL_SCROLLBACK_LINES,
  showReasoning: true,
};

function normalizeTheme(
  theme: unknown,
  deps?: Pick<SettingsDeps, "allowedThemes" | "fallbackTheme">,
): AppSettings["theme"] | null {
  if (typeof theme !== "string") {
    return null;
  }

  const migratedTheme = LEGACY_THEMES.has(theme)
    ? LEGACY_THEME_MIGRATIONS[theme as LegacyThemeName]
    : theme;

  if (!VALID_THEMES.has(migratedTheme)) {
    return null;
  }
  if (!deps?.allowedThemes || deps.allowedThemes.has(migratedTheme)) {
    return migratedTheme as AppSettings["theme"];
  }
  return deps.fallbackTheme ?? DEFAULT_CLIENT_SETTINGS.theme;
}
```

`packages/app/src/hooks/use-settings/index.ts` 继续从主题权威导入 Android 目录和兜底，不再创建
平台专属主题列表。

- [ ] **步骤 4：运行存储测试确认转绿**

运行：

```powershell
npx vitest run packages/app/src/hooks/use-settings/storage.test.ts --bail=1
```

预期：该文件全部测试通过，0 个失败。

- [ ] **步骤 5：提交任务二**

```powershell
git add -- packages/app/src/hooks/use-settings/storage.ts packages/app/src/hooks/use-settings/storage.test.ts packages/app/src/hooks/use-settings/index.ts
git commit -m "fix(app): migrate legacy themes to cyber dark"
```

---

### Task 3：统一主题名称并完成消费者验证

**文件：**

- 修改：`packages/app/src/i18n/index.test.ts`
- 修改：`packages/app/src/i18n/index.ts`

**接口：**

- 消费：Task 1 已接入的 `ACTIVE_THEME_NAMES` 和 `THEME_PICKER_OPTIONS`
- 行为：两端设置菜单展示相同的产品名称
- 验证：快捷键循环和两端设置菜单继续消费统一主题目录

- [ ] **步骤 1：先写主题名称失败测试**

在 `packages/app/src/i18n/index.test.ts` 增加：

```typescript
it("uses the five product theme names in Chinese", () => {
  const i18n = createAppI18n("zh-CN");
  expect(i18n.t("settings.general.theme.options.light")).toBe("Blockchain Light");
  expect(i18n.t("settings.general.theme.options.dark")).toBe("Cyber Dark");
  expect(i18n.t("settings.general.theme.options.liquid-neon")).toBe("Liquid Glass");
  expect(i18n.t("settings.general.theme.options.chisaki")).toBe("Chisaki");
  expect(i18n.t("settings.general.theme.options.aemeath")).toBe("Aemeath");
});
```

英文资源断言使用同样五个产品名称，`auto` 分别保持“跟随系统”和“System”。

- [ ] **步骤 2：运行 i18n 测试并确认按预期失败**

运行：

```powershell
npx vitest run packages/app/src/i18n/index.test.ts --bail=1
```

预期：当前“浅色”“深色”“玻璃”等旧名称导致失败。

- [ ] **步骤 3：更新中英文主题名称**

更新 `packages/app/src/i18n/index.ts` 的中英文主题名称，删除旧主题名称资源。复核
`AppContainer.tsx` 和 `settings-screen.tsx` 已分别消费 `ACTIVE_THEME_NAMES` 与
`THEME_PICKER_OPTIONS`；若 Task 1 已正确完成，不重复改写这些消费者。

- [ ] **步骤 4：运行 i18n 和主题测试确认转绿**

运行：

```powershell
npx vitest run packages/app/src/i18n/index.test.ts --bail=1
npx vitest run packages/app/src/styles/theme.test.ts --bail=1
```

预期：两个目标测试文件全部通过。

- [ ] **步骤 5：执行代码质量验证**

运行：

```powershell
npm run typecheck --workspace=@chisacode/app
npm run lint -- packages/app/src/styles/theme.ts packages/app/src/styles/theme.test.ts packages/app/src/styles/unistyles.ts packages/app/src/hooks/use-settings/storage.ts packages/app/src/hooks/use-settings/storage.test.ts packages/app/src/hooks/use-settings/index.ts packages/app/src/app/_layout/AppContainer.tsx packages/app/src/screens/settings-screen.tsx packages/app/src/i18n/index.ts packages/app/src/i18n/index.test.ts
npm run format:files -- packages/app/src/styles/theme.ts packages/app/src/styles/theme.test.ts packages/app/src/styles/unistyles.ts packages/app/src/hooks/use-settings/storage.ts packages/app/src/hooks/use-settings/storage.test.ts packages/app/src/hooks/use-settings/index.ts packages/app/src/app/_layout/AppContainer.tsx packages/app/src/screens/settings-screen.tsx packages/app/src/i18n/index.ts packages/app/src/i18n/index.test.ts
```

预期：typecheck 和 lint 退出码为 0，格式化完成。

- [ ] **步骤 6：提交任务三**

```powershell
git add -- packages/app/src/i18n/index.ts packages/app/src/i18n/index.test.ts
git commit -m "feat(app): unify theme selection across desktop and Android"
```

---

### Task 4：真实端验收与收尾

**文件：**

- 检查：`packages/desktop/scripts/dev.ps1`
- 检查：`docs/mobile-testing.md`
- 更新：`docs/refactors/comprehensive-improvement-roadmap.md`（仅当发现新的系统性主题问题）

- [ ] **步骤 1：运行全部目标测试作为最终自动化证据**

```powershell
npx vitest run packages/app/src/styles/theme.test.ts --bail=1
npx vitest run packages/app/src/hooks/use-settings/storage.test.ts --bail=1
npx vitest run packages/app/src/i18n/index.test.ts --bail=1
npm run typecheck --workspace=@chisacode/app
```

预期：所有命令退出码为 0。

- [ ] **步骤 2：真实 Electron 验收**

使用 `packages/desktop/scripts/dev.ps1` 启动真实 Electron。打开设置页，依次验证跟随系统和五套
固定主题；重点检查工作区、左侧栏、输入框、下拉菜单、环境面板和设置页，保存截图与控制台错误
证据。浏览器页面不能替代此步骤。

- [ ] **步骤 3：真实 Android 验收**

按 `docs/mobile-testing.md` 使用已连接设备或模拟器。依次切换五套固定主题和跟随系统，重启应用
确认设置持久化；检查状态栏、导航栏、侧栏、工作区、输入框、菜单和紧凑设置页。

如果当前没有可用设备或模拟器，明确记录 Android 真实端未完成，不用浏览器结果冒充。

- [ ] **步骤 4：最终审查与提交验收修复**

审查从计划基线到当前 HEAD 的完整 diff。任何 Electron 或 Android 验收中发现的主题问题必须先
补目标测试，再修复并重新验证。若没有额外代码变更，不创建空提交。
