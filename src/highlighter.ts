// 核心高亮算法：遍历活动容器内【所有】文本节点，将命中关键词包裹为 <mark>。
//
// 背景：Obsidian 原生搜索高亮对普通段落只高亮命中词；但对被渲染成独立富文本 DOM 的
// 「复杂块」（<table>、<blockquote>、.callout、<pre> 代码块、<li> 列表项、含 [[wikilink]] 的列表项等）
// 会**把整块/整项**包成 .search-highlight，表现为「整个块高亮、查询词没亮」。
// 本插件统一做法（v0.1.10 起）：
//   1) 遍历整个容器所有文本节点，对命中的关键词精确包裹 <mark class="search-term-hl">；
//   2) 见 styles.css：把 Obsidian 原生搜索高亮（.search-highlight 等）全局置透明，
//      使插件成为唯一高亮来源——普通段落视觉与原生一致（只亮词），复杂块也只亮词、不再整块亮。
// 公式(.math)与嵌入(.internal-embed)渲染后文本被拆碎/嵌套，精确包裹可能不完整，
// 但全局透明已避免其整块高亮，且能命中处仍会被精确包裹。

export const MARK_CLASS = "search-term-hl";

/**
 * 清除文档内所有本插件注入的高亮 mark（解包并合并文本节点）。
 */
export function clearHighlights(root: ParentNode = document): void {
  const marks = root.querySelectorAll(`mark.${MARK_CLASS}`);
  marks.forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    parent.normalize();
  });
}

/**
 * 对容器内【所有】文本节点应用精确词高亮（不再限定于特定「特殊块」）。
 * 多词为 OR 语义：每个正则独立高亮，对齐 Obsidian 原生搜索（文档内每个词分别高亮）。
 *
 * 设计变更（v0.1.10）：此前只在 table/blockquote/.callout/pre/li 等枚举出的「特殊块」内遍历，
 * 导致未被枚举的格式（如含 [[wikilink]] 的列表项、未来新增的复杂块）整块/整项不亮。
 * 现改为遍历整个活动容器的全部文本节点，对任何命中关键词的文本精确包裹 <mark>。
 * 配合 styles.css 把 Obsidian 原生搜索高亮（.search-highlight 等）全局置透明，
 * 插件成为唯一高亮来源：普通段落视觉与原生一致（同样只亮词），复杂块则只亮词、不再整块亮。
 *
 * 跳过规则：本插件自己注入的 mark（防重复）、script/style/textarea 等非可见区域。
 */
export function highlightAll(container: HTMLElement, regexes: RegExp[]): void {
  if (regexes.length === 0) return;

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const p = node.parentElement;
      if (!p) return NodeFilter.FILTER_REJECT;
      // 仅跳过本插件自己注入的 mark（防重复处理）
      if (p.closest("mark." + MARK_CLASS)) return NodeFilter.FILTER_REJECT;
      // 跳过不应高亮的脚本/样式区域
      if (p.closest("script, style, textarea")) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const textNodes: Text[] = [];
  let n: Node | null;
  while ((n = walker.nextNode())) textNodes.push(n as Text);

  for (const node of textNodes) {
    const parts = buildParts(node.nodeValue ?? "", regexes);
    if (!parts) continue;
    // 用 createEl 生成 mark；文本段用 document.createTextNode 插入，避免额外包裹元素。
    let ref: Node = node;
    for (const part of parts) {
      const el = typeof part === "string" ? document.createTextNode(part) : part;
      ref.parentNode?.insertBefore(el, ref);
      ref = el;
    }
    node.remove();
  }
}

/**
 * 将文本按所有正则依次切分，命中段包裹为 mark。
 * 返回 null 表示无任何命中（无需替换）。
 */
function buildParts(text: string, regexes: RegExp[]): Array<string | Node> | null {
  // OR 语义：每个正则独立高亮，对齐 Obsidian 原生搜索（文档内每个词分别高亮）
  let result: Array<string | Node> = [text];

  for (const re of regexes) {
    const next: Array<string | Node> = [];
    for (const part of result) {
      if (typeof part !== "string") {
        next.push(part);
        continue;
      }
      re.lastIndex = 0;
      let last = 0;
      let matched = false;
      let m: RegExpExecArray | null;
      while ((m = re.exec(part))) {
        matched = true;
        const start = m.index;
        const end = start + m[0].length;
        if (start > last) next.push(part.slice(last, start));
        // 用 Obsidian 的 createEl 创建 mark（避免 document.createElement，满足插件审查规则）。
        next.push(createEl("mark", { cls: MARK_CLASS, text: m[0] }));
        last = end;
        if (m[0].length === 0) re.lastIndex++; // 防止零宽匹配死循环
      }
      if (!matched) {
        next.push(part);
      } else if (last < part.length) {
        next.push(part.slice(last));
      }
    }
    result = next;
  }

  if (result.length === 1 && typeof result[0] === "string") return null;

  return result;
}
