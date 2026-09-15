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
- Settings: case sensitivity, regex mode (manual command only), and auto switch to Reading view on search-result click.

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

**Where Search Highlight+ fits:** it is the plugin for the exact moment *"you clicked a global search result and the note opened."* In Reading view it turns Obsidian's default whole-cell / whole-block flash into a precise keyword highlight — including inside tables, callouts, code blocks, and list items that contain `[[wikilinks]]`. Because it reads the query from the search-view instance rather than desktop-only DOM selectors, the same behavior works on mobile.

> Note: for the global-search flow the precise highlight lands in **Reading view** (the "Auto switch to Reading view" setting handles this automatically); the manual command and in-note `Ctrl+F` also work in Live Preview.

## Usage

1. Install and enable the plugin.
2. Run a global search (or an in-note search) and click a result.
3. The matched keyword is highlighted inside complex blocks. The native whole-block flash appears briefly and then fades, leaving only the keyword highlight.

Manual command: **`Search Highlight+: Highlight current note keywords`** lets you highlight the keywords of a query you type (supports regex when the regex setting is on).

## Settings

- **Case sensitive** — match exact letter case.
- **Regex mode** — applies only to the manual command; the whole input is treated as a regular expression.
- **Auto switch to Reading view** — automatically open the note in Reading view when clicking a global search result (recommended; Live Preview global search produces no persistent highlight markers).

## Compatibility

Requires Obsidian 1.4.0 or later. Works on desktop and mobile.

## License

MIT
