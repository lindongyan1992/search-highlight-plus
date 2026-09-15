import { Plugin, MarkdownView, PluginSettingTab, Setting } from "obsidian";
import { QueryOptions } from "./query";
import {
  clearHighlights,
  highlightAll,
  MARK_CLASS,
} from "./highlighter";

const PLUGIN_VERSION = "0.1.13";

const SEARCH_INPUT_SELECTOR =
  ".search-input-container input, input.search-input, .editor-search-input";

interface TableSearchHighlightSettings extends QueryOptions {
  /** 点击全局搜索结果时，自动把笔记切换到阅读（预览）模式。
   *  原因：Live Preview 下全局搜索点开文件只做滚动/选中，不产生持久高亮标记；
   *  阅读视图会持久渲染搜索高亮，插件才能复用其关键词照亮表格。 */
  autoReadingMode: boolean;
}

const DEFAULT_SETTINGS: TableSearchHighlightSettings = {
  caseSensitive: false,
  regex: false,
  autoReadingMode: true,
};

export default class SearchHighlightPlus extends Plugin {
  private settings: TableSearchHighlightSettings = { ...DEFAULT_SETTINGS };
  private query = "";
  private observer: MutationObserver | null = null;
  private applyTimer: number | null = null;
  private pendingSearch = false;
  private boundInputs = new WeakSet<HTMLInputElement>();
  private bodyObserver: MutationObserver | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new SettingTab(this));
    this.addCommand({
      id: "highlight-manual",
      name: "高亮当前笔记关键词（手动输入）",
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
    console.log(`[SearchHighlight+] loaded v${PLUGIN_VERSION}`);
  }

  onunload(): void {
    document.removeEventListener("click", this.onSearchClick, true);
    document.removeEventListener("input", this.onDocumentInput, true);
    this.stopObserver();
    this.stopBodyWatcher();
    clearHighlights(document);
    console.log(`[SearchHighlight+] unloaded`);
  }

  // 加载后自动恢复：若全局搜索框里有查询词，直接复用并高亮当前笔记，
  // 无需用户删词重搜。仅在确有查询词时才进入「待搜索」流程（需要时才自动切阅读模式）。
  private recoverState(): void {
    const q = this.readSearchInput();
    if (q) {
      this.query = q;
      this.pendingSearch = true;
      this.applyForPending();
    } else {
      this.requestApply();
    }
  }

  // 统一入口：若处于「待搜索」状态则先确保阅读模式（复杂块高亮依赖），再多次重试高亮。
  private applyForPending(): void {
    this.pendingSearch = false;
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      this.scheduleApply();
      return;
    }
    const after = () => this.scheduleApply();
    if (this.settings.autoReadingMode) {
      this.ensureReadingMode(view).then(after);
    } else {
      after();
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
    if (!el || !(el instanceof HTMLInputElement)) return;
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
      const inputs = root.querySelectorAll<HTMLInputElement>("input");
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
        state: { ...(state.state as Record<string, unknown> | undefined), mode: "preview" },
      });
    } catch (err) {
      console.warn("[SearchHighlight+] 切换到阅读模式失败", err);
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
    const word = window.prompt("输入要高亮的关键词（空格分隔多个词）：", this.query);
    if (word === null) return;
    this.query = word.trim();
    this.scheduleApply();
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

    const leaves = this.app.workspace.getLeavesOfType("markdown");
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeView) return;

    // 只使用搜索框里的精确查询词：保证只高亮关键词本身，绝不把整格/整段的原生高亮标记当词。
    // 复杂块（表格/引用块/callout/代码块/列表项/含 wikilink 的列表项等）内只亮关键词；
    // 原生整块 flash 由 Obsidian 自身控制，本插件不干预、也不依赖其类名。
    const q = this.query || this.readSearchInput();
    const terms = new Set<string>();
    if (q) {
      q.split(/\s+/).filter(Boolean).forEach((t) => terms.add(t));
    }
    if (terms.size === 0) return;

    const regexes = Array.from(terms).map(
      (t) => new RegExp(escapeRegExp(t), this.settings.caseSensitive ? "g" : "gi")
    );

    let totalMarks = 0;
    for (const leaf of leaves) {
      const v = leaf.view;
      if (!(v instanceof MarkdownView)) continue;
      const c = this.getContainer(v);
      if (!c) continue;
      highlightAll(c, regexes);
      totalMarks += c.findAll(`mark.${MARK_CLASS}`).length;
      if (v === activeView) this.observe(c);
    }

    console.log(
      `[SearchHighlight+] terms=${Array.from(terms).join("|")} marks=${totalMarks}`
    );
  }

  private getContainer(view: MarkdownView): HTMLElement | null {
    const preview = view.contentEl.querySelector(".markdown-preview-sizer") as HTMLElement | null;
    if (preview) return preview;
    const cm = (view.editor as unknown as { cm?: { dom: HTMLElement } }).cm?.dom ?? null;
    if (cm) return cm;
    return view.contentEl;
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
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }
  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
    containerEl.createEl("h2", { text: "Search Highlight+ 设置" });

    new Setting(containerEl)
      .setName("点击搜索结果自动阅读模式")
      .setDesc(
        "开启后，点击全局搜索结果会把笔记切到阅读（预览）模式——这是让复杂格式（表格/引用块/列表项等）内关键词高亮稳定生效的关键（Live Preview 下全局搜索不产生持久高亮标记）。如你更想保留编辑模式，可关闭，但复杂格式高亮仅在阅读模式下生效。"
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.autoReadingMode).onChange(async (value) => {
          this.plugin.settings.autoReadingMode = value;
          await this.plugin.saveSettings();
          this.plugin.requestApply();
        })
      );

    new Setting(containerEl)
      .setName("区分大小写")
      .setDesc("默认不区分；开启后表格高亮按大小写严格匹配（跟随原生搜索高亮时一般无需开启）。")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.caseSensitive).onChange(async (value) => {
          this.plugin.settings.caseSensitive = value;
          await this.plugin.saveSettings();
          this.plugin.requestApply();
        })
      );

    new Setting(containerEl)
      .setName("正则模式（手动命令）")
      .setDesc("仅手动命令生效：将整条输入作为一条正则表达式匹配。跟随原生搜索高亮时此开关无效。")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.regex).onChange(async (value) => {
          this.plugin.settings.regex = value;
          await this.plugin.saveSettings();
          this.plugin.requestApply();
        })
      );
  }
}
