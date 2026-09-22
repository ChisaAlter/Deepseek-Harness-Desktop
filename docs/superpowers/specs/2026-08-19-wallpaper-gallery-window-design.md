# 壁纸图库窗口与图源管理

外观里的背景图要能**浏览**，不能把「贴 JSON URL」当成产品。点「浏览图库」弹出窗口：上面分类 + 搜索，下面图片网格；可收藏；点图先确认是否设为壁纸，确认后再裁剪。图源的新增 / 编辑 / 删除也在这个窗口里，不拉到外观页。

视觉语言仍是官方 `dsh web`：`ui-primitives` + `--dsw-alias-*`。不抄 `marketplace.css` 的 hex，不新开 Electron 窗口，不第二套皮肤。见 [design-language.md](../../design-language.md)。

## 决定

1. **浏览窗口是产品。** 分类（图源页签 + 子分类）在上，搜索在上，网格在下。收藏是星标。点击缩略图弹出确认「将这张图设为背景？」——是：下载全图并打开现有裁剪；否：关掉确认，图库仍开着。
2. **图源在浏览窗口里 CRUD。** 外观只留选择图片、浏览图库、裁剪、毛玻璃、像素化。图库窗口里有「图源」：列表（显示名、类型、编辑、删除）和「新增」。不在外观页再画一块图源。
3. **预置必应和 Wallhaven。** 必应 = 官方今日 `HPImageArchive` + 中文历史归档 `https://bing.npanuhin.me/CN-zh.{year}.json`。Wallhaven = `https://wallhaven.cc/api/v1/search`，**写死 `purity=100`（仅 SFW）**，没有 NSFW 开关，不向用户要 API key。
4. **自定义图源是具名 HTTPS JSON 目录。** 格式仍是必应 `images[]` 或 `{ items: [{ id, title, thumbUrl, imageUrl, copyright? }] }`。每条有显示名，作为图库里的一个分类页签。
5. **持久化在 Host `ui-theme`。** 图源列表和收藏写进主题设置，不进桌面 `config.json`，不和插件市场混用。`dsh web` 没有 preload 时不显示浏览按钮。
6. **旧字段只做一次迁入。** `wallpaperBingEnabled` / `wallpaperCatalogUrls` 若磁盘上还在，在解析时变成 `wallpaperSources`；之后只读写新字段。不再把必应开关和裸 URL 列表画在界面上。

## 非目标

- Unsplash / Pexels / Pixabay（要开发者 Key）。
- Timeline / 拾光登录、Cookie、R18。
- 用户在设置里填写 Wallhaven API key。
- 新开独立 Electron 窗口或市场皮肤。
- 把 `downloadWallpaper` 绑死到「上次目录快照」的 SSRF 会员表（自定义目录仍是用户填的 HTTPS）。
- `test:web` 快照（本切片不改组装对话 UI，除非执行时可见输出变了再单开）。

## 图源记录

```ts
type WallpaperSourceKind = 'bing' | 'wallhaven' | 'catalog'

type WallpaperSource = {
  id: string
  kind: WallpaperSourceKind
  name: string
  url?: string // 仅 catalog
}
```

| 规则 | 值 |
|---|---|
| `id` | `bing`、`wallhaven`、自定义 `catalog-` + 稳定短 id（不要每次保存都换） |
| `name` | 1–40 字符，trim 后非空 |
| `kind: bing` / `wallhaven` | 全局最多各一条；没有 `url` |
| `kind: catalog` | 必须是 `https:` URL，最长 500 字符；最多 5 条 |
| 新增必应/Wallhaven | 已存在则拒绝，文案说明已添加 |
| 删除 | 任意图源可删；删光后图库分类只剩「收藏」 |
| 缺省 | Host 从未写过 `wallpaperSources` 时预置必应 + Wallhaven（名「必应」「Wallhaven」） |
| 空数组 | 用户删光后的合法状态，不要每次启动再预置 |

编辑：改 `name`；catalog 还可改 `url`。不能把 bing/wallhaven 改成 catalog，也不能改 `kind`。

## 收藏记录

```ts
type WallpaperFavorite = {
  id: string
  sourceId: string
  title: string
  thumbUrl: string
  imageUrl: string
}
```

最多 100 条。星标切换：已收藏则移除，未收藏则追加。`id` 与图库条目 `id` 一致（如 `bing-2026-08-19`、`wallhaven-5k8x7z`）。收藏页签只读这份列表，不联网。

## 浏览窗口

仍用 `ui-primitives` `Modal`，图库窗口约 880×720，不要 BrowserWindow。页签用 `Pill` 选中态，不要近黑胶囊填满工具栏。

```
浏览图库                              [ 图源 ] [ × ]
[ 图源页签… ]  [ 收藏 ]               [ 搜索 ]
[ 子分类 chips ]
--------------------------------
网格（缩略图 + 标题 + 星标）
```

点标题栏「图源」切到同一窗口里的图源列表（新增 / 编辑 / 删除），再点「返回图库」回到网格。新增 / 编辑用叠在图库上的小对话框。

- **页签** = 当前 `wallpaperSources` 的 `name` 顺序 + 固定「收藏」。
- **必应子分类：** 「今日」+ 最近 8 个年份（含今年）。今日走官方 `idx=0&n=8` 与 `idx=8&n=8`；年份走 `CN-zh.{year}.json`，条目上限仍 500。搜索只过滤已加载条目的 title/copyright。
- **Wallhaven 子分类：** 常规 `categories=100`、动漫 `010`、人物 `001`。搜索框写入 API 的 `q`。`sorting=toplist`，`atleast=1920x1080`，`purity=100`。先拉 `page=1`；有下一页则网格底「加载更多」。
- **catalog：** 无子分类。搜索过滤已加载条目。
- **收藏：** 无子分类。搜索过滤已收藏标题。
- 缩略图 `<img src={thumbUrl} referrerPolicy="no-referrer">`，**不加** `crossOrigin="anonymous"`。
- 切换页签 / 子分类 / 搜索（Wallhaven 防抖 300ms）会取消进行中的列表请求，避免回写乱序。
- 点卡片：先确认，再 `downloadWallpaper(imageUrl)`，成功才关图库并打开裁剪。下载失败留在图库，status 文案。关闭图库必须作废进行中的下载（现有 generation token）。

## 主进程

现有 `src/main/wallpaper-catalog.js` 扩展，不新建一套 HTTP 栈。

`listWallpaperCatalog(query)`：

| query | 行为 |
|---|---|
| `{ kind: 'bing', year?: number }` | 无 year：官方两页 HPImageArchive。有 year：GET 归档 JSON，解析为同一套 item。 |
| `{ kind: 'wallhaven', q?: string, categories: '100'\|'010'\|'001', page?: number }` | GET Wallhaven search；`purity` 在主进程写死 `100`，忽略渲染层传入的其它 purity。 |
| `{ kind: 'catalog', url: string }` | 现有自定义 JSON 解析。 |

条目统一 `{ id, title, copyright, thumbUrl, imageUrl, source }`。`source` 为图源 `id`。

下载仍走 `downloadWallpaper`：HTTPS（fixture 可 `DSHD_WALLPAPER_ALLOW_HTTP=1`）、12MB、类型白名单、无 cookie、最多 4 次重定向。Wallhaven 的 `path` / 归档 jpg / 必应图都走这条，裁剪源不得用页面 `<img>` 画布。

目录 JSON 4MB、每源 500 条、流式封顶保持不变。Wallhaven 单页通常远小于 500。

## 图库内图源

仅在 `wallpaperShell()` 非空时显示「浏览图库」。图源列表画在该窗口内部，不在外观页。

- 列表行：名字、类型标签（必应 / Wallhaven / 目录）、编辑、删除。
- 新增：叠层 Modal 选类型；必应/Wallhaven 只填名字（有默认）；目录填名字 + URL。校验失败留在 Modal。
- 编辑：Modal 预填；保存走同一套 sanitize。
- 删除：立刻从列表去掉并持久化，无第二层确认（条目少、可再新增）。

## 迁入

`resolveThemeSettings`：

- 已有 `wallpaperSources`（含空数组）→ `sanitizeWallpaperSources`。
- 否则预置必应 + Wallhaven，再把旧 `wallpaperCatalogUrls` 逐条变成 catalog（名字用 hostname）。忽略旧 `wallpaperBingEnabled`（新产品默认就有必应图源，用户不想要就在设置里删）。

Host Zod：`wallpaperSources`、`wallpaperFavorites` 为权威字段。旧两字段可继续 default，避免老 `settings.yaml` 校验失败；Adopt 时写入新字段后不必再写旧字段。

## 失败

| 情况 | 用户看见 |
|---|---|
| 列表失败 | 网格空 + status（现有「无法读取图库」或主进程返回的 warning） |
| Wallhaven/归档超时 | 同上，不把其它图源一起拖死 |
| 年份归档 404 | 该年空网格 + 短 status |
| 下载失败 | 图库仍开，status 下载失败 |
| 裁剪失败 | 裁剪对话框留下，不写入未裁原图（已有行为） |

## 测试

- `theme-settings` / store：sanitize、缺省预置、空数组不回种、旧 URL 迁入、收藏上限 100。
- `wallpaper-catalog.test.js`：必应今日、按年归档 JSON、Wallhaven `purity=100` 与条目映射、非法 URL、4MB/500 仍在。
- Appearance：无图源块；浏览打开窗口；窗口内图源新增/编辑/删除；页签切换触发对应 list 参数；星标写入收藏；点图出现确认；否不裁剪；是才 download+crop；取消图库忽略迟到下载。
- 普通 `dsh web`：无浏览按钮。

## Agent Note

更新 `2026-08-18-wallpaper-gallery-and-crop` 三件套为当前产品（窗口 + 图源 CRUD + 必应/Wallhaven），现在时，中英配对。ui-theme README Known Limitations 写清：Wallhaven 仅 SFW、必应历史依赖第三方归档、图源最多 5 条自定义目录。
