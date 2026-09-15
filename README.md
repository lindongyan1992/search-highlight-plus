# Search Highlight+

Highlight only the matched keywords inside complex Markdown blocks when you open a note from search results — instead of the default whole-block / whole-cell highlight.

## Features

- When you jump from a global search result (or run an in-note `Ctrl+F` search) and open the note, the plugin highlights **only the keyword** inside:
  - Tables (cell content)
  - Blockquotes
  - Callouts
  - Code blocks
  - List items, including list items that contain `[[wikilinks]]`
- Works in both Reading view and Live Preview.
- Keeps the native brief block flash (the momentary whole-block highlight that appears when you jump to a result) — only the *persistent* highlight is made keyword-precise.
- Settings: case sensitivity, regex mode (manual command only), auto switch to Reading view on search-result click, and a **custom highlight color**.

## Why

When the matched text lives inside a richly rendered block, the default behavior highlights the entire table cell / blockquote / callout / code block / list item, not just the word. This plugin makes the persistent highlight keyword-precise for those blocks.

## How it compares to other search-highlight plugins

Search Highlight+ is deliberately narrow: it only changes **what gets highlighted** at the moment you open a note from a search result. It does *not* replace Obsidian's search, nor your in-note find (Ctrl+F).

| Plugin | Approach | Modes | Keyword-precise highlight inside complex blocks on search-result open? |
| --- | --- | --- | --- |
| **Search Highlight+ (this)** | Refines Obsidian's default *whole-block* highlight into a *keyword-precise* one | Reading view (recommended) + Live Preview; desktop + mobile | ✅ Table cells, callouts, code blocks, list items (incl. `[[wikilinks]]`) |
| Dynamic Highlights | Highlights by cursor selection or persistent regex rules | Source / Live Preview only — **no Reading mode** | ⚠️ Editor-only; not driven by search-result open |
| Highlight Same Matches | Highlights every occurrence of selected text (Notepad++ style) | Live Preview / Reading | ⚠️ Skips rendered tables in Live Preview (needs Source mode) |
| Find in Note | In-note Ctrl+F replacement; paints every match via CSS Custom Highlight API (no reflow) | Reading + Live Preview; desktop + mobile | ✅ But it is an in-note find, not the search-result-open flow |
| Hotlines | Highlights whole *lines* matching keyword/regex rules | Reading + Live Preview; desktop + mobile | ⚠️ Highlights the full row, not the keyword |
| SwiftMatch / SearchPlus | Vault-wide selection / filter search with counters & result fragments | Editor / result pane | ⚠️ Highlight lives in the result list, not the rendered note |

**Where Search Highlight+ fits**: it is the plugin for the exact moment *"you clicked a global search result and the note opened."* In Reading view it turns Obsidian's default whole-cell / whole-block flash into a precise keyword highlight — including inside tables, callouts, code blocks, and list items that contain `[[wikilinks]]`. Because it reads the query from the search-view instance rather than desktop-only DOM selectors, the same behavior works on mobile.

> Note: for the global-search flow the precise highlight lands in **Reading view** (the "Auto switch to Reading view" setting handles this automatically); the manual command and in-note `Ctrl+F` also work in Live Preview.

## Usage

1. Install and enable the plugin.
2. Run a global search (or an in-note search) and click a result.
3. The matched keyword is highlighted inside complex blocks. The native whole-block flash appears briefly and then fades, leaving only the keyword highlight.

Manual command: **`Search Highlight+: Highlight current note keywords`** lets you highlight the keywords of a query you type (supports regex when the regex setting is on).

## Settings

- **Auto switch to Reading view** — automatically open the note in Reading view when clicking a global search result (recommended; Live Preview global search produces no persistent highlight markers).
- **Case sensitive** — match exact letter case.
- **Regex mode** — applies only to the manual command; the whole input is treated as a regular expression.
- **Highlight color** — background color of the keyword highlight. Leave empty to follow your theme's highlight color; pick a color to override it everywhere the plugin highlights.

## Compatibility

Requires Obsidian 1.4.0 or later. Works on desktop and mobile.

## License

MIT

---

# Search Highlight+（中文）

当你从搜索结果打开一则笔记时，只在复杂 Markdown 块（表格、引用块、标注、代码块、列表项）内高亮匹配到的关键词，而不是像 Obsidian 默认那样高亮整个块 / 整格。

## 功能特性

- 当你从全局搜索结果跳转（或在笔记内按 `Ctrl+F` 搜索）并打开笔记时，插件只在以下位置高亮**关键词本身**：
  - 表格（单元格内容）
  - 引用块
  - 标注（callout）
  - 代码块
  - 列表项，包括含有 `[[wikilinks]]` 的列表项
- 在阅读视图（Reading view）和实时预览（Live Preview）下均可工作。
- 保留 Obsidian 原生的短暂整块闪烁（跳转结果时一闪而过的整块高亮）——我们只把*持久*高亮变得"只亮关键词"。
- 设置项：区分大小写、正则模式（仅手动命令生效）、点击搜索结果自动切换到阅读视图，以及**自定义高亮颜色**。

## 为什么需要它

当匹配文本位于富渲染块内部时，Obsidian 默认会高亮整个表格单元格 / 引用块 / 标注 / 代码块 / 列表项，而不是只高亮那个词。本插件让这些块的持久高亮变得"只亮关键词"。

## 与其他搜索高亮插件的差异

Search Highlight+ 的定位刻意做窄：它只改变**你从搜索结果打开笔记那一刻**的高亮内容，既不替代 Obsidian 的搜索，也不替代笔记内的查找（Ctrl+F）。

| 插件 | 做法 | 支持模式 | 点击搜索结果打开时，复杂块内是否做关键词级精准高亮？ |
| --- | --- | --- | --- |
| **Search Highlight+（本插件）** | 把 Obsidian 默认「整块高亮」收敛为「关键词级」精准高亮 | 阅读视图（推荐）+ 实时预览；桌面 + 移动端 | ✅ 表格单元格、标注、代码块、列表项（含 `[[wikilinks]]`） |
| Dynamic Highlights | 按光标选区或持久正则规则高亮 | 仅 Source / 实时预览——**无阅读模式** | ⚠️ 仅编辑器内；不跟随"点击搜索结果打开"这条流 |
| Highlight Same Matches | 高亮所选文本的全部出现位置（Notepad++ 风格） | 实时预览 / 阅读视图 | ⚠️ 实时预览下会跳过渲染后的表格（需切到 Source 模式） |
| Find in Note | 笔记内 Ctrl+F 替代方案；用 CSS Custom Highlight API 高亮、不引起重排 | 阅读视图 + 实时预览；桌面 + 移动端 | ✅ 但它是"笔记内查找"，不是"点击搜索结果打开"这条流 |
| Hotlines | 高亮匹配关键词/正则规则的整**行** | 阅读视图 + 实时预览；桌面 + 移动端 | ⚠️ 高亮的是整行，而非关键词 |
| SwiftMatch / SearchPlus | 库级选择 / 过滤搜索，带计数与结果片段 | 编辑器 / 结果面板 | ⚠️ 高亮落在结果列表，而非渲染后的笔记块 |

**本插件适合的场景**：专为"你点击了某条全局搜索结果、笔记被打开"的这一刻而生。在阅读视图下，它会把 Obsidian 默认的整格 / 整块闪烁收敛为精准的关键词高亮——包括表格、标注、代码块，以及含有 `[[wikilinks]]` 的列表项。因为它从搜索视图实例读取查询词，而非依赖桌面专属的 DOM 选择器，所以在移动端表现一致。

> 说明：在全局搜索这条流里，精准高亮落在**阅读视图**（"点击搜索结果自动切换阅读视图"开关会自动处理）；手动命令和笔记内 `Ctrl+F` 在实时预览下同样可用。

## 使用方法

1. 安装并启用插件。
2. 进行全局搜索（或笔记内搜索），点击某条结果。
3. 匹配到的关键词会在复杂块内高亮；原生的整块闪烁会短暂出现后淡出，只留下关键词高亮。

手动命令：**`Search Highlight+: Highlight current note keywords`**（高亮当前笔记关键词）可让你输入关键词进行高亮（开启正则设置后支持正则）。

## 设置项

- **点击搜索结果自动切换阅读视图** — 点击全局搜索结果时自动用阅读视图打开笔记（推荐；实时预览下的全局搜索不会产生持久高亮标记）。
- **区分大小写** — 严格按字母大小写匹配。
- **正则模式** — 仅对手动命令生效；整条输入作为正则表达式处理。
- **高亮颜色** — 关键词高亮的背景色。留空则跟随主题的高亮色；自选颜色后会覆盖插件所有高亮处的背景色。

## 兼容性

需要 Obsidian 1.4.0 或更高版本，桌面端与移动端均可使用。

## 许可证

MIT
