import { Plugin, MarkdownView, PluginSettingTab, Setting, ButtonComponent, Platform, Modal } from "obsidian";
import type { EditorView } from "@codemirror/view";
import { QueryOptions } from "./query";
import {
  clearHighlights,
  highlightAll,
  MARK_CLASS,
} from "./highlighter";
import { highlightField, setHighlightQuery } from "./cm-highlighter";

/** 高亮色为不透明纯色。预设色卡本身已都是浅色，正文里直接画满色块即可，无需再叠透明度。 */

/** 预设高亮色卡。
 *  刻意只放浅色：高亮的本质是「底色块 + 上面压正文」，深色底会迫使文字反色、与正文反差过大反而花。
 *  不提供黑/白/灰——黑白在明暗主题里总有一种看不清，灰与正文对比太弱，起不到高亮作用。
 *  色卡存在的意义：系统取色器（<input type="color">）弹出的调色盘由 OS 决定（手机上偏深、含黑白），
 *  插件无法定制其备选色，只能另绘一排自己可控的浅色。 */
const PRESET_COLORS: { name: string; hex: string }[] = [
  { name: "Yellow", hex: "#FFD84D" },
  { name: "Orange", hex: "#FFAE5C" },
  { name: "Coral", hex: "#FF8D7A" },
  { name: "Pink", hex: "#F79BC4" },
  { name: "Red", hex: "#FFA0A5" },
  { name: "Purple", hex: "#BFA2F5" },
  { name: "Blue", hex: "#9BC3FF" },
  { name: "Teal", hex: "#A0F0E6" },
  { name: "Green", hex: "#D2FF91" },
];

/** 「默认」高亮色 = 浅黄（与色卡第一格同色）。
 *  未自定义（highlightColor 为空）时就用它显式覆盖，而**不**再退回主题变量/原生强调环：
 *  - 主题变量 --text-highlight-bg / 原生查找高亮（box-shadow 强调色环）在各主题、各平台观感不一，
 *    曾导致「点 Reset 后并没有恢复成默认的浅黄色」（桌面与手机表现不同）。
 *  - 固定成浅黄后，Reset 的预期结果（回到默认浅黄）在编辑模式、阅读模式、桌面、手机上都一致可预期。 */
const DEFAULT_HIGHLIGHT_HEX = "#FFD84D";

// 诊断开关：控制是否自动点击原生查找条的「Find all / 查找全部」（v0.1.24 起加入）。
// 设为 false = 只打开查找条并填词、不点按钮，用于排查「点击搜索结果时笔记跳变」是否由该点击引起。
// 排查完成后可改回 true。
const CLICK_FIND_ALL: boolean = false;

const SEARCH_INPUT_SELECTOR =
  ".search-input-container input, input.search-input, .editor-search-input";

interface TableSearchHighlightSettings extends QueryOptions {
  /** 点击全局搜索结果时，自动把笔记切换到阅读（预览）模式。
   *  原因：Live Preview 下全局搜索点开文件只做滚动/选中，不产生持久高亮标记；
   *  阅读视图会持久渲染搜索高亮，插件才能复用其关键词照亮表格。 */
  autoReadingMode: boolean;
  /** 高亮背景色。空字符串 = 跟随 Obsidian 主题变量 (--text-highlight-bg)。
   *  非空 = 用户自定义十六进制颜色，由 applyColorOverride() 通过 CSS 变量注入。 */
  highlightColor: string;
}

const DEFAULT_SETTINGS: TableSearchHighlightSettings = {
  caseSensitive: false,
  regex: false,
  autoReadingMode: true,
  highlightColor: "",
};

export default class SearchHighlightPlus extends Plugin {
  settings: TableSearchHighlightSettings = { ...DEFAULT_SETTINGS };
  private query = "";
  private observer: MutationObserver | null = null;
  private applyTimer: number | null = null;
  private pendingSearch = false;
  private boundInputs = new WeakSet<HTMLInputElement>();
  private bodyObserver: MutationObserver | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.applyColorOverride();
    this.addSettingTab(new SettingTab(this));

    // 编辑模式就地高亮：注册 CM6 扩展（预览模式仍走 DOM 注入）。
    this.registerEditorExtension(highlightField);

    this.addCommand({
      id: "highlight-manual",
      name: "Highlight keywords in current note (manual input)",
      callback: () => this.manualHighlight(),
    });

    document.addEventListener("click", this.onSearchClick, true);
    document.addEventListener("input", this.onDocumentInput, true);

    this.registerEvent(this.app.workspace.on("file-open", () => this.scheduleApply()));
    this.registerEvent(
      this.app.workspace.on("layout-change", () => {
        this.bindSearchInputs();
        this.requestApply();
      })
    );
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.onActiveLeafChange()));

    this.app.workspace.onLayoutReady(() => {
      this.bindSearchInputs();
      this.recoverState();
    });
    this.setupBodyWatcher();
  }

  onunload(): void {
    document.removeEventListener("click", this.onSearchClick, true);
    document.removeEventListener("input", this.onDocumentInput, true);
    this.stopObserver();
    this.stopBodyWatcher();
    clearHighlights(document);
  }

  // 加载后自动恢复：若全局搜索框里有查询词，直接复用并高亮当前笔记，
  // 无需用户删词重搜。仅在确有查询词时才进入「待搜索」流程（需要时才自动切阅读模式）。
  private recoverState(): void {
    const q = this.readSearchInput();
    if (q) {
      this.query = q;
      // 关闭「自动切阅读模式」时用原生查找条实现「笔记内搜索」——不在启动时自动弹查找条，
      // 只在用户点击搜索结果时才触发（见 applyForPending / runNativeFind）。
      if (this.settings.autoReadingMode) {
        this.pendingSearch = true;
        this.applyForPending();
        return;
      }
    }
    this.requestApply();
  }

  // 统一入口：处于「待搜索」状态时按开关分流——
  //   开：先确保阅读模式，再多次重试插件 DOM 高亮；
  //   关：不切模式、不用插件高亮，改为驱动 Obsidian 原生「笔记内查找」并点「Find all」。
  private applyForPending(): void {
    this.pendingSearch = false;
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      this.scheduleApply();
      return;
    }
    if (this.settings.autoReadingMode) {
      this.ensureReadingMode(view).then(() => this.scheduleApply()).catch(() => {});
    } else {
      this.runNativeFind();
    }
  }

  // 点击全局搜索结果片段
  private onSearchClick = (e: MouseEvent): void => {
    const t = e.target as HTMLElement | null;
    if (!t) return;
    if (!t.closest(".search-result-file-match") && !t.closest(".search-result")) return;
    const q = this.readSearchInput();
    if (q) this.query = q;
    this.pendingSearch = true;
    this.scheduleApply();
  };

  // 文件/叶切换：若处于「待搜索」状态，先把当前笔记切到阅读模式，再重绘
  private onActiveLeafChange = (): void => {
    if (this.pendingSearch) {
      this.applyForPending();
    } else {
      this.requestApply();
    }
  };

  private onDocumentInput = (e: Event): void => {
    const el = e.target as HTMLElement | null;
    if (!el || !el.instanceOf(HTMLInputElement)) return;
    if (!el.matches(SEARCH_INPUT_SELECTOR)) return;
    this.query = el.value.trim();
    this.requestApply();
  };

  private readSearchInput(): string {
    // 优先从搜索视图实例读取（桌面/移动通用，不依赖具体 DOM class）。
    // 移动端全局搜索是独立搜索视图，其输入框 class 可能与桌面侧边栏不同，
    // 故直接遍历 search 类型 leaf 的输入框，而非只查固定选择器。
    const searchLeaves = this.app.workspace.getLeavesOfType("search");
    for (const leaf of searchLeaves) {
      const root = (leaf.view as unknown as { containerEl?: HTMLElement })?.containerEl;
      if (!root) continue;
      const exact = root.querySelector<HTMLInputElement>(
        ".search-input-container input, input.search-input"
      );
      const exactVal = exact?.value?.trim();
      if (exactVal) return exactVal;
      // 宽松兜底：搜索视图内第一个有内容的文本输入框（覆盖移动端未知 class）
      const inputs = Array.from(root.querySelectorAll<HTMLInputElement>("input"));
      for (const inp of inputs) {
        if (inp.type === "checkbox" || inp.type === "radio") continue;
        const v = inp.value?.trim();
        if (v) return v;
      }
    }
    // fallback：直接查 DOM（兼容桌面侧边搜索 / 编辑器内搜索）
    const inp = document.querySelector<HTMLInputElement>(SEARCH_INPUT_SELECTOR);
    return inp?.value?.trim() ?? "";
  }

  // 把指定 Markdown 视图切换到阅读（预览）模式
  private async ensureReadingMode(view: MarkdownView): Promise<void> {
    if (!this.settings.autoReadingMode) return;
    try {
      const state = view.leaf.getViewState();
      const mode = (state.state as { mode?: string } | undefined)?.mode;
      if (mode === "preview") return;
      await view.leaf.setViewState({
        type: "markdown",
        state: { ...(state.state ?? {}), mode: "preview" },
      });
    } catch (err) {
      console.warn("[SearchHighlight+] Failed to switch to reading mode", err);
    }
  }

  private bindSearchInputs(): void {
    document.querySelectorAll<HTMLInputElement>(SEARCH_INPUT_SELECTOR).forEach((inp) => {
      if (this.boundInputs.has(inp)) return;
      this.boundInputs.add(inp);
      inp.addEventListener("input", this.onSearchInputInput);
    });
  }

  private onSearchInputInput = (e: Event): void => {
    const inp = e.target as HTMLInputElement;
    this.query = inp.value.trim();
    this.requestApply();
  };

  private setupBodyWatcher(): void {
    this.bodyObserver = new MutationObserver(() => this.bindSearchInputs());
    this.bodyObserver.observe(document.body, { childList: true, subtree: true });
  }
  private stopBodyWatcher(): void {
    this.bodyObserver?.disconnect();
    this.bodyObserver = null;
  }

  private manualHighlight(): void {
    const modal = new KeywordPromptModal(this, (word) => {
      this.query = word.trim();
      this.scheduleApply();
    });
    modal.open();
  }

  // 单次防抖应用（用于输入/布局变更等即时事件）
  requestApply(): void {
    if (this.applyTimer) window.clearTimeout(this.applyTimer);
    this.applyTimer = window.setTimeout(() => this.apply(), 60);
  }

  // 多次定时重试：覆盖「打开文件 → 切换模式 → 原生高亮渲染」的异步时序，
  // 确保表格高亮在任意一步完成后都能被捕获。
  private scheduleApply(delays: number[] = [70, 250, 600, 1100]): void {
    for (const d of delays) window.setTimeout(() => this.apply(), d);
  }

  private apply(): void {
    this.stopObserver();
    clearHighlights(document);

    // 关闭「自动切阅读模式」时：插件不注入任何高亮（高亮全部交给原生查找条，避免重复），
    // 仅清掉可能残留的编辑模式 CM 高亮后返回。
    if (!this.settings.autoReadingMode) {
      this.dispatchHighlight("");
      return;
    }

    const leaves = this.app.workspace.getLeavesOfType("markdown");
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);

    // 只使用搜索框里的精确查询词：保证只高亮关键词本身，绝不把整格/整段的原生高亮标记当词。
    // 复杂块（表格/引用块/callout/代码块/列表项/含 wikilink 的列表项等）内只亮关键词；
    // 原生整块 flash 由 Obsidian 自身控制，本插件不干预、也不依赖其类名。
    const q = this.getQuery();
    const terms = new Set<string>();
    if (q) {
      q.split(/\s+/).filter(Boolean).forEach((t) => terms.add(t));
    }

    // 编辑模式（Live Preview / Source）：交给 CM6 decoration 高亮。
    // 无论当前是否预览、是否有查询，都同步一次（空查询 = 清除编辑模式高亮）。
    this.dispatchHighlight();

    if (!activeView || terms.size === 0) return;

    const regexes = Array.from(terms).map(
      (t) => new RegExp(escapeRegExp(t), this.settings.caseSensitive ? "g" : "gi")
    );

    // 阅读模式：容器是静态 HTML，沿用 DOM 注入（编辑模式已由 CM decoration 处理，跳过）。
    for (const leaf of leaves) {
      const v = leaf.view;
      if (!(v instanceof MarkdownView)) continue;
      if (!this.isPreview(v)) continue;
      const c = this.getContainer(v);
      if (!c) continue;
      highlightAll(c, regexes);
      if (v === activeView) this.observe(c);
    }
  }

  // 当前生效的查询：优先用输入事件缓存的词，否则实时读搜索框。
  getQuery(): string {
    return this.query || this.readSearchInput();
  }

  // 把查询同步给所有 Markdown 编辑器的 CM6 扩展（编辑模式就地高亮 / 清除）。
  // queryOverride 传空串 = 显式清除；不传 = 用当前查询。
  private dispatchHighlight(queryOverride?: string): void {
    const query = queryOverride !== undefined ? queryOverride : this.getQuery();
    const caseSensitive = this.settings.caseSensitive;
    const leaves = this.app.workspace.getLeavesOfType("markdown");
    for (const leaf of leaves) {
      const v = leaf.view;
      if (!(v instanceof MarkdownView)) continue;
      const cm = (v.editor as unknown as { cm?: EditorView })?.cm;
      if (cm && typeof cm.dispatch === "function") {
        cm.dispatch({ effects: setHighlightQuery.of({ query, caseSensitive }) });
      }
    }
  }

  // 「笔记内搜索」（关闭「自动切阅读模式」时）：驱动 Obsidian 原生查找条——
  // 打开查找条并填入查询词（不自动点「Find all」、不自动滚动，避免视口跳变）。
  // 用户可自行在查找条内按回车/点上一条下一条定位；表格内的匹配通常需再点一次搜索结果片段才能定位。
  private runNativeFind(attempt = 0): void {
    const q = this.getQuery();
    this.apply(); // OFF 下 apply 只做清理（清残留的插件高亮），不会注入插件高亮
    if (!q) return;

    // 打开当前编辑器的原生查找条（编辑模式的查找条带「Find all」按钮；与 Mod+F 同款命令）。
    const ok = this.openNativeFindBar();
    if (!ok) {
      // 视图/编辑器可能尚未就绪，重试。
      if (attempt < 12) window.setTimeout(() => this.runNativeFind(attempt + 1), 100);
      return;
    }
    this.fillFindBar(q, 0);
  }

  // 打开原生「笔记内查找」条：优先走命令（editor:open-search = Mod+F）；命令不可用时
  // 退回调用视图的 showSearch(false)。两者都是 Obsidian 内部接口，故做类型断言。
  private openNativeFindBar(): boolean {
    const app = this.app as unknown as {
      commands?: { executeCommandById(id: string): boolean };
    };
    if (app.commands?.executeCommandById) {
      try {
        return app.commands.executeCommandById("editor:open-search");
      } catch (err) {
        console.warn("[SearchHighlight+] editor:open-search failed", err);
      }
    }
    const view = this.app.workspace.getActiveViewOfType(MarkdownView) as unknown as
      | { showSearch?: (replace?: boolean) => void }
      | null;
    if (view?.showSearch) {
      view.showSearch(false);
      return true;
    }
    return false;
  }

  // 等原生查找条渲染后填入查询词（不自动定位/不自动点按，避免视口跳变）。
  private fillFindBar(q: string, attempt: number): void {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const root: ParentNode = view?.containerEl ?? document;
    const bar = root.querySelector<HTMLElement>(".document-search-container");
    const input = bar?.querySelector<HTMLInputElement>(
      ".document-search-input input, input.document-search-input, .document-search input:not(.document-replace-input)"
    );
    if (!bar || !input) {
      if (attempt < 12) window.setTimeout(() => this.fillFindBar(q, attempt + 1), 80);
      return;
    }
    if (input.value !== q) {
      input.value = q;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    // 等查询注册（部分版本输入有防抖）后点「Find all」（诊断期由 CLICK_FIND_ALL 控制）。
    if (CLICK_FIND_ALL) window.setTimeout(() => this.clickFindAll(), 220);
  }

  // 点原生查找条里的「Find all / 查找全部」按钮——按图标 lucide-text-select 定位（跨语言稳定）。
  private clickFindAll(): void {
    const bars = Array.from(document.querySelectorAll<HTMLElement>(".document-search-container"));
    for (const bar of bars) {
      const icon = bar.querySelector("svg.lucide-text-select");
      const btn = icon?.closest("button") as HTMLElement | null;
      if (btn) {
        btn.click();
        return;
      }
    }
    console.warn("[SearchHighlight+] Find all button not found (is the note in reading mode?)");
  }

  // 判断 Markdown 视图是否处于阅读（预览）模式。
  private isPreview(view: MarkdownView): boolean {
    const mode = (view.leaf.getViewState().state as { mode?: string } | undefined)?.mode;
    return mode === "preview";
  }

  // 仅返回阅读模式的预览容器；编辑模式由 CM decoration 处理，不走 DOM 注入。
  private getContainer(view: MarkdownView): HTMLElement | null {
    return view.contentEl.querySelector(".markdown-preview-sizer");
  }

  private observe(container: HTMLElement): void {
    this.observer = new MutationObserver(() => this.requestApply());
    this.observer.observe(container, { childList: true, subtree: true });
  }
  private stopObserver(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
  }

  async loadSettings(): Promise<void> {
    const data = (await this.loadData()) as Partial<TableSearchHighlightSettings> | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data ?? {});
  }
  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  // 用户自定义高亮背景色：空值用默认浅黄，非空则通过 CSS 变量 --shp-highlight-color 覆盖（见 styles.css）。
  // 参考 Highlight Same Matches 的做法，用颜色输入框让用户自选高亮色。
  //
  // 需要覆盖三处（否则「关掉自动切阅读模式」后改色无效）：
  //  ① 插件自身标记 .search-term-hl —— 开关「开」时（预览 DOM / 编辑 CM 装饰）。
  //  ② OFF 模式下的原生「笔记内查找」高亮：编辑模式（CodeMirror）的
  //     span.obsidian-search-match-highlight —— 自带样式是 box-shadow 外环（--text-accent），
  //     不读 background-color，故必须显式改背景 + 干掉外环。
  //  ③ OFF 模式下原生高亮的阅读模式实现：.markdown-rendered .search-highlight > div
  //     是绝对定位覆盖层，同样靠 box-shadow 画环，需改为背景填充。
  //
  // 高亮色由 main.ts 写入 document.documentElement 的 --shp-highlight-color 变量，
  // 具体覆盖规则写在 styles.css（均用 var(--shp-highlight-color, #FFD84D)），
  // 不再运行时创建 <style> 元素（Obsidian 禁止插件动态插入 style 标签）。
  applyColorOverride(): void {
    const color = this.settings.highlightColor?.trim() || DEFAULT_HIGHLIGHT_HEX;
    document.documentElement.style.setProperty("--shp-highlight-color", color);
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// 「手动输入关键词高亮」命令：用 Obsidian 原生 Modal 收词（不调用 window.prompt，
// 后者在 Obsidian 的沙箱/移动端环境里行为不稳，且被插件审查规则禁止）。
class KeywordPromptModal extends Modal {
  private plugin: SearchHighlightPlus;
  private onSubmit: (value: string) => void;
  constructor(plugin: SearchHighlightPlus, onSubmit: (value: string) => void) {
    super(plugin.app);
    this.plugin = plugin;
    this.onSubmit = onSubmit;
  }
  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h4", { text: "Highlight keywords" });
    const input = contentEl.createEl("input", { type: "text" });
    input.value = this.plugin.getQuery();
    input.placeholder = "space-separated keywords";
    input.setCssStyles({ marginTop: "8px", width: "100%" });
    const submit = () => {
      const v = input.value.trim();
      this.close();
      if (v) this.onSubmit(v);
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submit();
      }
    });
    const btnRow = contentEl.createDiv({ cls: "modal-button-row" });
    btnRow.setCssStyles({ marginTop: "12px" });
    const ok = btnRow.createEl("button", { text: "Highlight", cls: "mod-cta" });
    ok.addEventListener("click", submit);
    const cancel = btnRow.createEl("button", { text: "Cancel" });
    cancel.addEventListener("click", () => this.close());
    window.setTimeout(() => input.focus(), 0);
  }
  onClose(): void {
    this.contentEl.empty();
  }
}

/** 取色输入解析：桌面端 = 系统取色器给的 `#rrggbb`；移动端 = 手输的「R,G,B」。
 *  兼容 `#RRGGBB` / `RRGGBB` / `255,216,77` / `255 216 77`（也认全角逗号）。
 *  解析不出来返回 `null` —— 由调用方回显当前生效色，不写盘。 */
function parseColorInput(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const hex = /^#?([0-9a-f]{6})$/i.exec(s);
  if (hex) return `#${hex[1].toLowerCase()}`;
  const parts = s.split(/[\s,，;；]+/).filter(Boolean);
  if (parts.length !== 3) return null;
  const nums = parts.map((p) => Number(p));
  if (!nums.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) return null;
  // 不用 padStart —— 项目 tsconfig 的 lib 未含 es2017，编译会报 TS2550。
  const h = (n: number) => (n < 16 ? `0${n.toString(16)}` : n.toString(16));
  return `#${nums.map(h).join("")}`;
}

/** `#rrggbb` → 「R, G, B」文本，用作移动端 RGB 输入框的回显格式。 */
function toRgbText(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "";
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

class SettingTab extends PluginSettingTab {
  private plugin: SearchHighlightPlus;
  constructor(plugin: SearchHighlightPlus) {
    super(plugin.app, plugin);
    this.plugin = plugin;
  }
  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl).setName("Keyword highlighting").setHeading();

    new Setting(containerEl)
      .setName("Auto reading mode on search result click")
      .setDesc(
        "When on, clicking a global search result switches the note to Reading (preview) mode and the plugin highlights the keywords itself. When off, the note stays in its current mode and the plugin opens the native in-note find bar pre-filled with your query. Note: to locate a matched keyword inside a table, you may need to click the global search result snippet twice."
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.autoReadingMode).onChange(async (value) => {
          this.plugin.settings.autoReadingMode = value;
          await this.plugin.saveSettings();
          this.plugin.requestApply();
        })
      );

    new Setting(containerEl)
      .setName("Case sensitive")
      .setDesc("Off by default. When on, highlights match case strictly.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.caseSensitive).onChange(async (value) => {
          this.plugin.settings.caseSensitive = value;
          await this.plugin.saveSettings();
          this.plugin.requestApply();
        })
      );

    new Setting(containerEl)
      .setName("Regex mode (manual command)")
      .setDesc("Only affects the manual command: treats the entire input as a single regular expression. Has no effect when following native search highlighting.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.regex).onChange(async (value) => {
          this.plugin.settings.regex = value;
          await this.plugin.saveSettings();
          this.plugin.requestApply();
        })
      );

    // 高亮颜色：Reset 按钮 + 取色控件 + 插件自绘的纯色预设色卡。
    // 取色控件按平台分叉：桌面保留系统取色器（<input type="color">，鼠标取色快）；
    // 移动端改为手输 RGB —— 系统取色器的调色盘由 OS/WebView 决定（手机上偏深、还含黑白），
    // 既不可定制、也很难精细调节，不如直接输入数值。
    let resetBtn: ButtonComponent | undefined;
    let colorInput: HTMLInputElement | undefined; // 桌面：系统取色器
    let rgbInput: HTMLInputElement | undefined; // 移动端：RGB 文本输入框
    const swatchEls: HTMLElement[] = [];
    const refreshColorUI = () => {
      const cur = (this.plugin.settings.highlightColor || "").toLowerCase();
      // 未自定义时实际渲染的就是「默认浅黄」，故让黄卡显示为选中态，界面与正文一致。
      const active = cur || DEFAULT_HIGHLIGHT_HEX.toLowerCase();
      if (resetBtn) {
        // 已是默认浅黄（无自定义色）时禁用；选过颜色后才可点，点一下回到默认浅黄。
        resetBtn.setButtonText("Reset");
        resetBtn.setDisabled(!cur);
      }
      for (const el of swatchEls) {
        el.classList.toggle("is-active", el.dataset.color === active);
      }
      const shown = /^#[0-9a-f]{6}$/i.test(active) ? active : DEFAULT_HIGHLIGHT_HEX;
      if (colorInput) colorInput.value = shown;
      if (rgbInput) rgbInput.value = toRgbText(shown);
    };

    const colorSetting = new Setting(containerEl)
      .setName("Highlight color")
      .setDesc(
        Platform.isMobile
          ? "Keyword highlight color. Default is a light yellow. Tap a preset swatch below, or type an RGB value such as 255, 216, 77 (Enter to apply). Swatches show the pure color; in a note the highlight is the same solid color."
          : "Keyword highlight color. Default is a light yellow. Click a preset swatch below, use the system color picker for any color, or press Reset to go back to the default. Swatches show the pure color; in a note the highlight is the same solid color. The color applies everywhere keywords are highlighted, including the native in-note find bar."
      )
      .addButton((btn) => {
        resetBtn = btn;
        refreshColorUI();
        // 先改内存状态 + 立即重绘（保证视觉立刻生效、且不受存档失败影响），最后再落盘。
        btn.onClick(async () => {
          this.plugin.settings.highlightColor = "";
          this.plugin.applyColorOverride();
          refreshColorUI();
          try {
            await this.plugin.saveSettings();
          } catch (err) {
            console.error("[SearchHighlight+] failed to save after reset", err);
          }
        });
      })
      .addText((text) => {
        const input = text.inputEl;
        // 统一入口：改内存 → 立即重绘 → 刷新设置页 UI → 落盘（失败只记日志，不打断视觉）。
        const commit = (hex: string) => {
          this.plugin.settings.highlightColor = hex;
          this.plugin.applyColorOverride();
          refreshColorUI();
          void this.plugin.saveSettings().catch((err) =>
            console.error("[SearchHighlight+] failed to save picked color", err)
          );
        };
        if (Platform.isMobile) {
          rgbInput = input;
          input.type = "text";
          input.addClass("shp-rgb-input");
          // 刻意**不设** inputmode="numeric"：部分安卓输入法的纯数字键盘会藏掉逗号键，
          // 用户就输不出「255, 216, 77」的分隔符了。用默认文本键盘，逗号/空格都在。
          input.setAttribute("autocomplete", "off");
          input.setAttribute("autocorrect", "off");
          input.setAttribute("autocapitalize", "off");
          input.setAttribute("spellcheck", "false");
          input.setAttribute("enterkeyhint", "done");
          input.placeholder = "255, 216, 77";
          input.value = toRgbText(this.plugin.settings.highlightColor || DEFAULT_HIGHLIGHT_HEX);
          const onCommit = () => {
            const hex = parseColorInput(input.value);
            if (!hex) {
              // 输入不合法（空 / 缺分量 / 越界）：回显当前生效色，不写盘。
              refreshColorUI();
              return;
            }
            commit(hex);
          };
          input.addEventListener("change", onCommit);
          input.addEventListener("blur", onCommit);
          input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onCommit();
              input.blur();
            }
          });
        } else {
          colorInput = input;
          input.type = "color";
          input.addClass("shp-color-input");
          input.value = this.plugin.settings.highlightColor || DEFAULT_HIGHLIGHT_HEX;
          const onPick = () => commit(input.value);
          input.addEventListener("input", onPick);
          input.addEventListener("change", onPick);
        }
      });

    // 预设浅色色卡：另起一行、占满宽度（见 styles.css 的 .shp-color-item / .shp-color-swatches）。
    colorSetting.settingEl.addClass("shp-color-item");
    const swatchRow = colorSetting.settingEl.createDiv("shp-color-swatches");
    for (const preset of PRESET_COLORS) {
      const sw = swatchRow.createEl("button", { cls: "shp-swatch" });
      sw.dataset.color = preset.hex.toLowerCase();
      sw.setAttribute("aria-label", preset.name);
      sw.setAttribute("title", preset.name);
      // 卡面用**不透明**色块填充：色卡只作「这是哪一支色」的标识，
      // 半透明填充在深浅主题下会被底色拉偏、也难分辨相近色，故一律画纯色。
      // 色卡与正文高亮同为不透明纯色，所见即所得。
      sw.style.backgroundColor = preset.hex;
      sw.addEventListener("click", () => {
        this.plugin.settings.highlightColor = preset.hex;
        this.plugin.applyColorOverride();
        refreshColorUI();
        void this.plugin.saveSettings().catch((err) =>
          console.error("[SearchHighlight+] failed to save preset color", err)
        );
      });
      swatchEls.push(sw);
    }
    refreshColorUI();
  }
}
