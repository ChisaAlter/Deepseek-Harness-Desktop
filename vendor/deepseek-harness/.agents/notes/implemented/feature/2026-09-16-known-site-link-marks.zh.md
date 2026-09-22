# Agent Note: 已知站点链接标记

Status: implemented

[English](2026-09-16-known-site-link-marks.md) | 中文

## Problem

转写内容中的每个锚点都以同一个地球图形开头，因此满是 GitHub、npm 与文档链接的对话在读者解析标签之前，无法从图形看出链接去向。[可点击链接词汇](2026-09-04-web-clickable-link-styles.zh.md) 把该前置位置留给一个分类图形，并把按站点区分的标记留作 `url` 类别日后可能的扩展。

## Decision

`LinkIcon` 接受可选的 `href`。对于 `url` 类别，目的地主机属于已知站点时改画该站点自己的标记；其余 `url` 目的地仍使用地球，文件类别忽略 `href`，因为它们的目的地是路径而不是站点。

ui-primitives 的 `SiteGlyph.tsx` 持有该映射：四十个主机后缀解析为三十四个标记。转写内容常引用的开发者站点：GitHub（`github.com`、`github.io`、`raw.githubusercontent.com`）、GitLab、npm、PyPI、Stack Overflow、MDN、Wikipedia、Hacker News（`news.ycombinator.com`）、YouTube（`youtube.com`、`youtu.be`）、X（`x.com`、`twitter.com`）、Bilibili、知乎、掘金与 CSDN。普通用户常访问的主流站点：搜索（Google、百度、DuckDuckGo）、视频与音频（TikTok、Netflix、Spotify）、社交与通讯（Facebook、Instagram、Reddit、Telegram 及 `t.me` 短链、WhatsApp 及 `wa.me`、`weixin.qq.com` 上的微信、QQ、微博）、购物（淘宝、速卖通、eBay）、参考资料与社区（Quora、V2EX）以及 Apple。主机等于某后缀或为其子域即匹配，且最长匹配后缀优先，因此 `gist.github.com` 与 `en.wikipedia.org` 无需单独登记，而 `weixin.qq.com` 得到微信标记而不是其 `qq.com` 后缀同样会选中的 QQ 标记。只有绝对 `http:` 与 `https:` 目的地能够匹配，其余一律回退到地球。

图形取自 [Simple Icons](https://simpleicons.org) 图标集（CC0-1.0），以 ui-primitives 的 devDependency 形式引入，因此新增站点只是主机映射中的一条记录，图形版本由 lockfile 固定，而不是复制路径数据。每个标记以该图标集的单条 path 绘制在其 24 单位 viewBox 上，并内缩到 28 单位盒中，以保留 20 单位 `ic_ds_*` 图形在自身盒内约 8% 的留白；填充使用链接的 `currentColor`，而不是图标集记录的品牌填充色。所有标记均为 `aria-hidden`，锚点自身文本仍是可访问名称。

对功能性链接图形采用 `currentColor` 是刻意的取舍，而非品牌呈现：YouTube、X、Instagram 等品牌公布的规范禁止为其标记改色，下方第一个备选方案比较了固定品牌填充的做法。CC0-1.0 覆盖路径数据；每个标记仍属其所有者的商标，生成的第三方声明覆盖该 npm 包本身，而不是这份图形。

两处消费者传入自己的目的地：markdown 渲染器的 `renderSafeLink`（覆盖作者书写的锚点、引用式链接与提升为链接的行内代码）以及 web 卡片的来源与抓取链接。两者本已持有经安全校验的目的地。

## Alternatives considered

- **抓取各站点的 favicon**，无论取自站点本身还是 favicon 服务。这能覆盖任意站点，但渲染一份转写内容会向每个被链接的主机发起网络请求，泄露阅读行为并把文本渲染变成网络操作；它在离线与严格 `img-src` 策略下同样失败。拒绝：固定的本地词汇表让渲染保持确定与私密，地球仍是诚实的回退。
- **以站点品牌色填充标记。** 拒绝：链接图形只使用 `currentColor`，以跟随链接 alias、暗色模式与 hover；固定填充会成为首个例外，并与链接自身的 hover 颜色冲突。
- **把路径数据复制进本模块。** 拒绝：上游会持续更新的第三方图形集正是需要固定版本依赖来跟踪的内容；十四个内嵌副本没有更新路径。
- **把站点值加进 `LinkIconKind`。** 拒绝：kind 是消费者陈述的分类，而站点由目的地推导；把两者折进同一联合类型会迫使每个消费者写出自己并不知晓的站点。
- **为每个未映射主机生成首字母方块。** 以噪音为由拒绝：自动生成的字母胶囊宣称了一种站点身份却没有承载它，14px 也没有留下可读字母的空间。

## Consequences

- 新增站点需要在 `SiteGlyph.tsx` 的主机映射中加一条记录，并在 `link-icon` spec 中补一个 URL 才会被检查：该 spec 为每个已映射站点列出一个代表 URL、要求它们共产生三十四个互不相同的标记，并固定 GitHub、npm、YouTube、Wikipedia、X、Telegram 与 WhatsApp 的别名。记录丢失或重复会让数量断言失败，而只改主机映射、不补 spec URL 的新站点仍未被 spec 覆盖。
- 词汇表按类别而非按需求增长：每个站点需要一条主机映射、一个上游标记与一个 spec URL；这三十四个标记在源码中增加约 23 KB 路径数据，经 shell 构建的 tree-shake、压缩与 gzip 后进入入口 chunk 的只有几 KB。
- `simple-icons` 作为 ui-primitives 的开发依赖进入浏览器构建图；shell 构建会 tree-shake 所导入的标记，而不是整套图标。
- 未收录主机、非 http scheme、无法解析的目的地与文件类别都保留原有的地球或分类图形；转写内容中的 `mailto` 链接仍显示地球。
- 该词汇表刻意有限。像 `example.com` 这样的站点不会由此机制获得标记；要识别它们就需要被上述备选方案拒绝的网络抓取。
- 覆盖：LinkIcon spec 覆盖别名、各回退分支与尺寸座位；markdown spec 固定一个已知锚点与一个未知锚点；web 卡片 spec 用同一批标记固定一个来源链接与一个抓取链接。
