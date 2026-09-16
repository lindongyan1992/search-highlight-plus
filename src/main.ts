import { Plugin, MarkdownView, PluginSettingTab, Setting, ButtonComponent } from "obsidian";
import type { EditorView } from "@codemirror/view";
import { QueryOptions } from "./query";
import {
  clearHighlights,
  highlightAll,
  MARK_CLASS,
} from "./highlighter";
import { highlightField, setHighlightQuery } from "./cm-highlighter";

const PLUGIN_VERSION = "0.1.24";

const SEARCH_INPUT_SELECTOR =
  ".search-input-container input, input.search-input, .editor-search-input";

interface TableSearchHighlightSettings extends QueryOptions {
  /** 点击全局搜索结果时，自动把笔记切换到阅读（预览）模式。
   *  原因：Live Preview 下全局搜索点开文件只做滚动/选中，不产生持久高亮标记；
   *  阅读视图会持久渲染搜索高亮，插件才能复用其关键词照亮表格。 */
  autoReadingMode: boolean;
  /** 高亮背景色。空字符串 = 跟随 Obsidian 主题变量 (--text-highlight-bg)。
   *  非空 = 用户自定义十六进制颜色，由 applyColorOverride() 注入 style 覆盖。 */
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
      this.ensureReadingMode(view).then(() => this.scheduleApply());
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
        state: { ...(state.state as Record<string, unknown> | undefined), mode: "preview" },
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
    const word = window.prompt("Enter keywords to highlight (space-separated):", this.query);
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
    let totalMarks = 0;
    for (const leaf of leaves) {
      const v = leaf.view;
      if (!(v instanceof MarkdownView)) continue;
      if (!this.isPreview(v)) continue;
      const c = this.getContainer(v);
      if (!c) continue;
      highlightAll(c, regexes);
      totalMarks += c.findAll(`mark.${MARK_CLASS}`).length;
      if (v === activeView) this.observe(c);
    }

    console.log(
      `[SearchHighlight+] terms=${Array.from(terms).join("|")} domMarks=${totalMarks}`
    );
  }

  // 当前生效的查询：优先用输入事件缓存的词，否则实时读搜索框。
  private getQuery(): string {
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
  // 打开查找条、填入查询词、点「Find all / 查找全部」，由原生高亮全部匹配。
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

  // 等原生查找条渲染后填入查询词（不直接回车/跳转，交给后面的 Find all）。
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
    // 等查询注册（部分版本输入有防抖）后点「Find all」。
    window.setTimeout(() => this.clickFindAll(), 220);
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
    return view.contentEl.querySelector(".markdown-preview-sizer") as HTMLElement | null;
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

  // 用户自定义高亮背景色：空值跟随主题变量，非空则注入 style 覆盖 .search-term-hl。
  // 参考 Highlight Same Matches 的做法，用颜色输入框让用户自选高亮色。
  applyColorOverride(): void {
    const id = "search-highlight-plus-color";
    const el = document.getElementById(id) as HTMLStyleElement | null;
    const color = this.settings.highlightColor?.trim();
    if (!color) {
      if (el) el.remove();
      return;
    }
    if (!el) {
      const created = document.createElement("style");
      created.id = id;
      document.head.appendChild(created);
    }
    const target = document.getElementById(id) as HTMLStyleElement | null;
    if (target) {
      target.textContent = `.search-term-hl { background-color: ${color} !important; }`;
    }
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
    containerEl.createEl("h2", { text: "Search Highlight+ Settings" });

    new Setting(containerEl)
      .setName("Auto reading mode on search result click")
      .setDesc(
        "When on, clicking a global search result switches the note to Reading (preview) mode and the plugin highlights the keywords itself. When off, the note stays in its current mode and the plugin instead runs the native in-note find: it opens the find bar with your query and triggers \"Find all\", letting Obsidian highlight every match."
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

    let resetBtn: ButtonComponent | undefined;
    const refreshResetBtn = () => {
      if (!resetBtn) return;
      // 跟随主题色（无自定义色）时禁用；选过颜色后才可点，点一下恢复主题色。
      const hasColor = !!this.plugin.settings.highlightColor;
      resetBtn.setButtonText("Reset");
      resetBtn.setDisabled(!hasColor);
    };

    new Setting(containerEl)
      .setName("Highlight color")
      .setDesc(
        "Background color of the keyword highlight. Leave empty to follow your theme's highlight color; pick a color to override it everywhere the plugin highlights."
      )
      .addButton((btn) => {
        resetBtn = btn;
        refreshResetBtn();
        btn.onClick(async () => {
          this.plugin.settings.highlightColor = "";
          await this.plugin.saveSettings();
          this.plugin.applyColorOverride();
          refreshResetBtn();
        });
      })
      .addText((text) => {
        const input = text.inputEl;
        input.type = "color";
        input.addClass("shp-color-input");
        input.value = this.plugin.settings.highlightColor || "#ffe66d";
        const onPick = async () => {
          this.plugin.settings.highlightColor = input.value;
          await this.plugin.saveSettings();
          this.plugin.applyColorOverride();
          refreshResetBtn();
        };
        input.addEventListener("input", onPick);
        input.addEventListener("change", onPick);
      });
  }
}
