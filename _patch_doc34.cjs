const fs = require("fs");

// ---- 设计笔记：新增 §3.20 + 更新版本号 ----
const docp = "D:/Users/MyKnowledge/50沉淀/02产出文档/Obsidian表格搜索高亮插件.md";
let d = fs.readFileSync(docp, "utf8");

const s1 = "线上最新公开版 = **0.1.33**。\n\n## 4. 工程结构";
const r1 = `线上最新公开版 = **0.1.33**。

### 3.20 过社区审查 lint 清理（v0.1.34）

- **背景**：插件发布到社区目录前会跑自动审查（obsidianmd 审查规则）。本轮清掉全部 Error 与大部分 Warning：
  - **Error: 动态创建/插入 \`<style>\` 元素** → 改为把高亮色写进 CSS 变量 \`--shp-highlight-color\`（\`document.documentElement.style.setProperty\`），具体覆盖规则移入 \`styles.css\`（用 \`var(--shp-highlight-color, #FFD84D)\`）。原因：Obsidian 禁止插件运行时注入 \`<style>\` 标签。
  - **Error: 设置页手写 \`h2\` 标题** → 改 \`new Setting(containerEl).setName("Search Highlight+ Settings").setHeading()\`。
  - **Warning: \`builtin-modules\` 依赖** → esbuild 配置改用 \`node:module\` 的 \`builtinModules\`，并从 \`package.json\` devDeps 移除（官方模板遗留、实际未用）。
  - **Warning: \`document.createElement\`（\`prefer-create-el\`）** → \`highlighter.ts\` 改用 Obsidian 全局 \`createEl("mark", ...)\` 生成高亮标记；\`buildFragment\` 重构为返回片段数组、\`highlightAll\` 用 \`insertBefore\` + \`node.remove()\` 组装，彻底去掉 \`createElement\` / \`createDocumentFragment\`。
  - **Warning: 不必要的 \`console.log\`** → 删掉加载/卸载/apply/取色等诊断日志（保留 catch 内的 \`console.warn\`/\`console.error\`）。
  - **Warning: 未 await 的 Promise** → \`ensureReadingMode(...).then(...)\` 补 \`.catch(() => {})\`。
  - **Warning: \`instanceof\` 跨窗口不安全** → \`el.instanceOf(HTMLInputElement)\`。
  - **Warning: 不必要的类型断言** → 去掉 \`as Record<string, unknown> | undefined\`（改 \`(state.state ?? {}) as Record<string, unknown>\`）与 \`as HTMLElement | null\`。
  - **Warning: \`window.prompt\` 不稳** → 「手动输入关键词高亮」命令改用 Obsidian \`Modal\`（\`KeywordPromptModal\`）收词。
  - **Warning: \`loadData()\` 返回 any 直接赋值** → 先 \`as Partial<TableSearchHighlightSettings> | null\` 再 \`Object.assign\`。
  - **Warning: CSS \`!important\`** → 去掉所有「特异性已胜出」的 \`!important\`（颜色输入框 / 色卡 / RGB 输入框），仅保留 2 条原生高亮覆盖规则（\`.cm-s-obsidian span.obsidian-search-match-highlight\` 与 \`.markdown-rendered .search-highlight > div\`）必需的 \`!important\`（用于压掉 Obsidian 自带 box-shadow 强调环）。
  - **未处理（非阻塞）**：\`getSettingDefinitions()\` 声明式设置 API 缺实现。原因：本插件设置页含自定义 UI（纯色色卡 / 手机 RGB 输入框 / Reset），声明式 API 无法表达；且审查技能指出实现它会**替换** \`display()\` 渲染（≥1.13 下丢色卡 UI）。故保留 \`display()\` 手绘，代价是设置项在 ≥1.13 的「设置搜索」里不可搜（功能不受影响）。
- **版本**：升 v0.1.34（manifest/versions.json 三处同步；\`PLUGIN_VERSION\` 因无人引用被 tree-shake 掉，版本以 manifest.json 为准）；\`tsc --noEmit\` 零错误；esbuild 重建 main.js=28680B / styles.css=8572B；部署桌面 vault（manifest=0.1.34，旧版备份 \`_backups/v0.1.33/\`）。手机端：本次设备未连接，ADB 部署待设备重连后补。
- **状态**：构建 + 桌面部署完成，**尚未 commit/tag/push**（待用户在 Obsidian 里重载插件验证观感后再走发布流程）。

## 4. 工程结构`;
if (!d.includes(s1)) { console.error("DOC anchor1 not found"); process.exit(1); }
d = d.replace(s1, r1);

const s2 = "├── manifest.json          # id=search-highlight-plus, v0.1.33, isDesktopOnly=false";
if (!d.includes(s2)) { console.error("DOC anchor2 not found"); process.exit(1); }
d = d.replace(s2, "├── manifest.json          # id=search-highlight-plus, v0.1.34, isDesktopOnly=false");

const s3 = "├── versions.json          # 0.1.0 ~ 0.1.33 → minAppVersion 1.4.0";
if (!d.includes(s3)) { console.error("DOC anchor3 not found"); process.exit(1); }
d = d.replace(s3, "├── versions.json          # 0.1.0 ~ 0.1.34 → minAppVersion 1.4.0");

fs.writeFileSync(docp, d, "utf8");
console.log("DOC patched OK");

// ---- 发布技能：补充 lint 陷阱 ----
const skp = "C:/Users/NINGMEI/.workbuddy/skills/obsidian-plugin-release/SKILL.md";
let k = fs.readFileSync(skp, "utf8");
const anchor = "- **Error: setName('Settings').setHeading()** → 整行删除。Obsidian 1.13+ 声明式 API 自动渲染标题,<1.13 自带插件名标题,无需手动 heading。\n";
const add = anchor + `- **Error: 动态创建/插入 \`<style>\` 元素** → Obsidian 禁止插件运行时 \`document.createElement('style')\` + \`head.appendChild\`。改法:把需动态变化的值(如高亮色)写进 CSS 变量(\`document.documentElement.style.setProperty('--x', val)\`),具体选择器/覆盖规则写在 \`styles.css\` 里用 \`var(--x, 默认值)\`。这是社区审查的硬性 Error。
- **Warning: \`document.createElement\`(\`prefer-create-el\`)** → 生成元素用 Obsidian 全局 \`createEl('mark', { cls, text })\`(不是 import 进来的,是全局函数);\`createDocumentFragment\` 也一并避免(改返回片段数组 +\`insertBefore\`/\`remove\` 组装)。
- **Warning: \`instanceof\` 跨窗口不安全** → \`el.instanceOf(HTMLInputElement)\`(Obsidian 给 HTMLElement 加了 \`instanceOf\` 方法)。
- **Warning: \`window.prompt\` 不稳** → 用 Obsidian \`Modal\` 收词,不要在插件里调 \`window.prompt\`。
- **Warning: CSS \`!important\`** → 仅当选择器特异性确实打不过 Obsidian 自带类时才用(如覆盖原生高亮 box-shadow 环);插件自有类一律靠「更高特异性」胜出、不加 \`!important\`。
`;
if (!k.includes(anchor)) { console.error("SKILL anchor not found"); process.exit(1); }
k = k.replace(anchor, add);
fs.writeFileSync(skp, k, "utf8");
console.log("SKILL patched OK");
