// ==UserScript==
// @name         X (Twitter) Timeline & Thread Archiver
// @name:zh-CN   X (Twitter) 时间线与帖子归档助手
// @namespace    https://github.com/miniyu157/x-timeline-archiver
// @version      v2026.3.19.2
// @description  Elegant and minimalist timeline & thread archiver for X.
// @description:zh-CN 优雅极简的 X (Twitter) 时间线与帖子归档工具。
// @author       Yumeka
// @license      MIT
// @match        *://x.com/*
// @match        *://twitter.com/*
// @icon         https://abs.twimg.com/favicons/twitter.3.ico
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @connect      api.github.com
// @run-at       document-end
// ==/UserScript==

/*
  X (Twitter) Timeline Archiver 更新日志
      --- v2026.3.19.2 ---
  * feat: 为菜单项硬编码 SVG 矢量图标, 来源: remixicon.com
  * feat: 新增 Issues 菜单入口

      --- v2026.3.19.1 ---
  * refactor: 申请 GM_xmlhttpRequest 权限用于连接 api.github.com 获取更新日志
  * fix: 修复更新日志窗口中的滚动条瑕疵

      --- v2026.3.19.0 ---
  * fix: 修复推文详情归档功能中, 首条推文包含引用推文时, 错误的忽略了首条推文的问题
  * fix: 修复推文详情页首条推文查看次数 (Views) 获取为 0 的问题
  * fix: 修复时间线视图中书签数量 (Bookmarks) 因 隐藏文本/已收藏状态 导致获取为 0 的问题, 采用集合差值算法提取

      --- v2026.3.18.2 ---
  * feat: 新增 Changelog 菜单, 它会根据仓库检索 tag 以查看更新日志

      --- v2026.3.18.1 ---
  * fix: 修复移动端时间线归档按钮失效

      --- v2026.3.18.0 ---
  * refactor: 移除硬编码 I18N 对象, 完全使用 DOM 结构解析
  * feat: 新增帖子树归档功能 (目前仅能获取表层回复, 并跳过裸露在外的回复)
      入口按钮在帖子卡片右上角 "更多" 按钮的附近
      每个帖子卡片都会显示菜单按钮, 其功能都是完全等效的
      菜单渲染采用上下文感知, 即根据 Timeline / Thread 视图自动隐藏或添加功能
      同步支持 CSV, JSON 格式导出
  * refactor!: 时间线归档功能中, 跳过裸露在外的回复 (推文串)
  * refactor!: 数据结构优化
      移除 isRetweet 字段, 新增 context 表示帖子附加信息 (例如: 你已转贴)
      字段 content, media 合并到 content 对象
      字段对象 author 中, nickname 重命名为 name
      字段对象 quote 中, 移除字段 url, id
  * perf: 添加防抖并优化性能
  * ui: 更换图标样式

      --- v2026.3.17.1 ---
  * feat: 添加导出格式菜单 JSON(L)/CSV；
  * feat!: 移除 lang 字段；
  * feat!: nickname 字段由包含昵称+ID, 改为仅包含昵称；
  * style: 代码风格变得更加紧凑。

      --- v2026.3.17.0 ---
  * feat: 新增 Dump Profile Data 功能；
  * feat: 新增抓取页面的多语言支持；
  * feat: 下载文件时的友好文件名。

      --- v2026.3.16.0 ---
  * init: 初始版本，功能不多，易维护。
*/

(() => {
  "use strict";

  const CONFIG = {
    repoUrl: "https://github.com/miniyu157/x-timeline-archiver",
    issuesUrl: "https://github.com/miniyu157/x-timeline-archiver/issues",
    licenseUrl: "https://github.com/miniyu157/x-timeline-archiver/blob/main/LICENSE"
  };

  const State = { format: "JSON(L)" };

  const DOM = {
    q: (s, c = document) => c.querySelector(s),
    qa: (s, c = document) => [...c.querySelectorAll(s)]
  };

  const Fmt = {
    d: () => {
      const d = new Date(), p = n => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}_${p(d.getMinutes())}_${p(d.getSeconds())}`;
    },
    i: () => (document.title.split('/')[0].trim() || location.pathname.split('/')[1] || "X").replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, "_"),
    f: (ext, t) => `X_${t}_${Fmt.i()}_${Fmt.d()}.${ext}`
  };

  const Store = {
    data: new Map(),
    excluded: new Set(),
    isScrolling: false,
    add(arr) { arr.forEach(e => e?.id && this.data.set(e.id, JSON.stringify(e))); },
    clear() { this.data.clear(); this.excluded.clear(); },
    clean() { this.excluded.forEach(id => this.data.delete(id)); }
  };

  const Changelog = {
    data: null,
    fetching: false,
    async request(url) {
      return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          method: "GET",
          url: url,
          onload: (res) => resolve(JSON.parse(res.responseText)),
          onerror: (err) => reject(err)
        });
      });
    },
    async fetch() {
      if (this.data) return this.data;
      if (this.fetching) return [];
      this.fetching = true;
      try {
        const repoPath = CONFIG.repoUrl.replace("https://github.com/", "");
        const tags = await this.request(`https://api.github.com/repos/${repoPath}/tags?per_page=5`);
        if (!Array.isArray(tags)) throw new Error(tags.message || "Invalid API response");
        this.data = await Promise.all(tags.map(async t => {
          const cData = await this.request(t.commit.url);
          return { v: t.name, m: cData.commit.message };
        }));
      } catch (e) {
        console.error("Archiver: Changelog fetch failed", e);
        this.data = [{ v: "Error", m: `Failed to fetch changelog.\n${e.message || "Network Error"}` }];
      }
      this.fetching = false;
      return this.data;
    }
  };

  const Modal = {
    el: null,
    init() {
      const style = document.createElement("style");
      style.textContent = `.x-archiver-modal[open]{display:flex;flex-direction:column;overflow:hidden;padding:0;border:none;border-radius:16px;background:var(--colors-background,#fff);color:var(--colors-text,#0f1419);width:90%;max-width:560px;max-height:80vh;overscroll-behavior:contain;box-shadow:rgba(101,119,134,0.2) 0 0 15px,rgba(101,119,134,0.15) 0 0 3px 1px}.x-archiver-modal::backdrop{background:rgba(0,0,0,0.4);backdrop-filter:blur(4px)}.x-am-header{flex-shrink:0;padding:16px 20px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--colors-border,#eff3f4);font-size:20px;font-weight:700}.x-am-close{cursor:pointer;background:0 0;border:none;font-size:24px;line-height:1;width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:inherit;transition:background .2s}.x-am-close:hover{background:rgba(15,20,25,.1)}.x-am-body{flex:1;padding:20px;overflow-y:auto;font-size:15px;line-height:1.5;white-space:pre-wrap;word-break:break-word}.x-am-item{margin-bottom:24px}.x-am-item:last-child{margin-bottom:0}.x-am-ver{font-size:17px;font-weight:700;color:#1d9bf0;margin-bottom:8px}@media(prefers-color-scheme:dark){.x-archiver-modal{background:#000;color:#e7e9ea;border:1px solid #2f3336;box-shadow:rgba(255,255,255,0.2) 0 0 15px,rgba(255,255,255,0.15) 0 0 3px 1px}.x-am-header{border-bottom-color:#2f3336}.x-am-close:hover{background:rgba(255,255,255,.1)}}`;
      document.head.appendChild(style);
      this.el = document.createElement("dialog");
      this.el.className = "x-archiver-modal";
      this.el.innerHTML = `<div class="x-am-header"><span>Changelog</span><button class="x-am-close">&times;</button></div><div class="x-am-body"></div>`;
      document.body.appendChild(this.el);
      DOM.q(".x-am-close", this.el).onclick = () => this.el.close();
      this.el.onclick = e => { if (e.target === this.el) this.el.close(); };
    },
    async open() {
      if (!this.el) this.init();
      this.el.showModal();
      const b = DOM.q(".x-am-body", this.el);
      if (b.innerHTML && b.innerHTML !== "Loading...") return;
      b.innerHTML = "Loading...";
      const d = await Changelog.fetch();
      b.innerHTML = d.map(x => `<div class="x-am-item"><div class="x-am-ver">${x.v}</div><div>${x.m.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</div></div>`).join("");
    }
  };

  const toCSV = (arr) => {
    if (!arr.length) return "";
    const keys = [...arr.reduce((s, r) => (Object.keys(r).forEach(k => s.add(k)), s), new Set())];
    const esc = v => {
      if (v == null) return "";
      const s = typeof v === "object" ? JSON.stringify(v) : String(v).replace(/\n/g, "\\n").replace(/\r/g, "\\r");
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return [keys.join(","), ...arr.map(r => keys.map(k => esc(r[k])).join(","))].join("\n");
  };

  const Exporters = {
    "JSON(L)": {
      timeline: { ext: "jsonl", mime: "application/jsonl", parse: m => [...m.values()].join("\n") },
      profile: { ext: "json", mime: "application/json", parse: d => JSON.stringify(d, null, 2) },
      thread: { ext: "json", mime: "application/json", parse: m => JSON.stringify([...m.values()].map(JSON.parse), null, 2) }
    },
    "CSV": {
      timeline: { ext: "csv", mime: "text/csv;charset=utf-8;", parse: m => toCSV([...m.values()].map(JSON.parse)) },
      profile: { ext: "csv", mime: "text/csv;charset=utf-8;", parse: d => toCSV([d]) },
      thread: { ext: "csv", mime: "text/csv;charset=utf-8;", parse: m => toCSV([...m.values()].map(JSON.parse)) }
    }
  };

  const Parser = {
    profile: () => {
      const txt = n => !n ? "" : [...n.childNodes].reduce((a, c) => c.nodeType === 3 ? a + (c.nodeValue || "") : c.nodeName === "IMG" && c.alt ? a + c.alt : a + txt(c), "");
      const ext = (s, p) => { try { const e = DOM.q(s); if (!e) return null; const v = p(e); return (v === "null" || v === "undefined" || v === "" || Number.isNaN(v)) ? null : v; } catch { return null; } };
      const n = DOM.qa('[data-testid="UserName"] div[dir="ltr"]');
      return {
        avatarUrl: ext('a[href$="/photo"] img', e => e.src), headerUrl: ext('a[href$="/header_photo"] img', e => e.src),
        displayName: n[0] ? txt(n[0]).trim() || null : null, handle: n[1] ? txt(n[1]).trim() || null : null,
        bio: ext('[data-testid="UserDescription"]', e => txt(e).trim()), location: ext('[data-testid="UserLocation"]', e => txt(e).trim()),
        website: ext('[data-testid="UserUrl"]', e => { const u = txt(e).trim(); return u ? (u.startsWith("http") ? u : `https://${u}`) : null; }),
        joinDate: ext('[data-testid="UserJoinDate"]', e => txt(e).trim()), following: ext('a[href$="/following"]', e => parseInt(txt(e).replace(/\D/g, ""), 10)),
        followers: ext('a[href$="/verified_followers"], a[href$="/followers"]', e => parseInt(txt(e).replace(/\D/g, ""), 10)), postCount: ext('h2[role="heading"] + div[dir="ltr"]', e => parseInt(txt(e).replace(/\D/g, ""), 10))
      };
    },
    metrics: (n) => {
      if (!n) return null;
      const ex = (selectors) => {
        const el = DOM.q(selectors, n);
        if (!el) return 0;
        const textSource = el.getAttribute('aria-label') || el.textContent || '';
        const match = textSource.match(/([\d,]+)/);
        return match ? parseInt(match[1].replace(/,/g, ''), 10) : 0;
      };

      const res = {
        replies: ex('[data-testid="reply"]'),
        retweets: ex('[data-testid="retweet"], [data-testid="unretweet"]'),
        likes: ex('[data-testid="like"], [data-testid="unlike"]'),
        views: ex('a[href$="/analytics"]'),
        bookmarks: ex('[data-testid="bookmark"], [data-testid="removeBookmark"]')
      };

      if (res.bookmarks === 0 && DOM.q('[data-testid="bookmark"], [data-testid="removeBookmark"]', n)) {
        const group = DOM.q('[data-testid="reply"]', n)?.closest('div[aria-label]');
        if (group) {
          const groupNums = (group.getAttribute('aria-label').match(/([\d,]+)/g) || []).map(x => parseInt(x.replace(/,/g, ''), 10));
          Object.values(res).filter(v => v > 0).forEach(v => {
            const idx = groupNums.indexOf(v);
            if (idx > -1) groupNums.splice(idx, 1);
          });
          if (groupNums.length === 1) res.bookmarks = groupNums[0];
        }
      }

      return res;
    },
    tx: (n) => {
      if (!n) return '';
      return [...n.childNodes].reduce((a, c) => c.nodeType === 3 ? a + c.textContent : c.nodeType === 1 ? a + ((c.tagName === 'IMG' && c.hasAttribute('alt')) ? c.getAttribute('alt') : Parser.tx(c)) : a, '');
    },
    au: (ctx) => {
      const b = DOM.q('[data-testid="User-Name"]', ctx);
      if (!b) return { name: null, handle: null, avatar: null };
      const l = [];
      const ex = n => n.childNodes.forEach(c => c.nodeType === 3 ? (c.textContent.trim() && l.push(c.textContent.trim())) : c.nodeType === 1 ? ((c.tagName === 'IMG' && c.hasAttribute('alt') && c.getAttribute('alt').trim()) ? l.push(c.getAttribute('alt').trim()) : ex(c)) : null);
      ex(b);
      const hIdx = l.findIndex(t => t.startsWith('@'));
      const handle = hIdx !== -1 ? l[hIdx] : null;
      const name = hIdx > 0 ? l.slice(0, hIdx).join('') : (l.length > 0 && l[0] !== handle ? l[0] : null);
      return { name, handle, avatar: DOM.q('[data-testid="Tweet-User-Avatar"] img', ctx)?.src || null };
    },
    sub: (n) => {
      let e = DOM.q('[data-testid="Tweet-User-Avatar"]', n);
      if (!e) return false;
      while (e.parentElement && !e.previousElementSibling) e = e.parentElement;
      const p = e.previousElementSibling;
      if (!p || DOM.q('[data-testid="socialContext"]', p)) return false;
      return [...p.querySelectorAll('*')].some(x => x.children.length > 1);
    },
    qt: (c) => {
      const u = DOM.qa('[data-testid="User-Name"]', c);
      if (u.length < 2) return null;
      let q = u[1];
      const ft = DOM.q('[data-testid="tweetText"]', c), mt = DOM.qa('time', c).pop();
      while (q.parentElement) {
        const p = q.parentElement;
        if (p.contains(u[0]) || (mt && mt !== DOM.q('time', q) && p.contains(mt)) || (ft && (ft.compareDocumentPosition(u[1]) & 4) && p.contains(ft))) break;
        q = p;
      }
      const d = { author: Parser.au(q), time: DOM.q('time', q)?.getAttribute('datetime') || null, content: { text: Parser.tx(DOM.q('[data-testid="tweetText"]', q)).trim() || null, media: DOM.qa('[data-testid="tweetPhoto"] img', q).map(i => i.src) } };
      q.remove();
      return d;
    },
    extract: (mode) => {
      const col = DOM.q('[data-testid="primaryColumn"]');
      if (!col) return [];
      const res = [];
      let fnode = null;

      if (mode === 'thread') {
        const fid = location.pathname.match(/\/status\/(\d+)/)?.[1];
        fnode = fid ? DOM.qa('time', col).map(t => t.closest('a')).find(a => a?.href.includes(`/${fid}`))?.closest('article') : null;
      }

      for (const c of DOM.qa('[data-testid="cellInnerDiv"]', col)) {
        if (mode === 'thread' && DOM.q('h2', c) && !DOM.q('article', c)) break;

        const a = DOM.q('article[data-testid="tweet"]', c);
        if (!a) continue;

        if (mode === 'thread' && fnode && (fnode.compareDocumentPosition(a) & 2)) continue;

        const id = DOM.q('time', a)?.closest('a')?.href?.split('/').pop() || null;
        const isFocal = (mode === 'thread' && res.length === 0 && Store.data.size === 0);

        if (!isFocal && Parser.sub(a)) {
          if (id) Store.excluded.add(id);
          continue;
        }

        const cl = a.cloneNode(true);
        const qtData = Parser.qt(cl); 
        const u = DOM.q('time', cl)?.closest('a');

        res.push({
          id: u?.href?.split('/').pop() || id, url: u?.href || null,
          context: DOM.q('[data-testid="socialContext"]', cl) ? Parser.tx(DOM.q('[data-testid="socialContext"]', cl)).trim() : null,
          time: DOM.q('time', cl)?.getAttribute('datetime') || null, author: Parser.au(cl),
          content: { text: DOM.q('[data-testid="tweetText"]', cl) ? Parser.tx(DOM.q('[data-testid="tweetText"]', cl)).trim() : null, media: DOM.qa('[data-testid="tweetPhoto"] img', cl).map(img => img.src) },
          quote: qtData, metrics: Parser.metrics(cl)
        });
      }
      return res;
    }
  };

  const ACTIONS = {
    exec: (data, type) => {
      if (!data || (type === 'profile' && !data.handle && !data.displayName) || (data instanceof Map && !data.size)) return;
      const conf = Exporters[State.format][type];
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([conf.parse(data)], { type: conf.mime }));
      a.download = Fmt.f(conf.ext, type.charAt(0).toUpperCase() + type.slice(1));
      a.click();
      URL.revokeObjectURL(a.href);
    },
    dump: (mode) => {
      Store.clear(); Store.add(Parser.extract(mode)); Store.clean(); ACTIONS.exec(Store.data, mode);
    },
    scroll: async (mode) => {
      if (Store.isScrolling) return;
      Store.clear(); Store.isScrolling = true; let idle = 0;
      while (Store.isScrolling) {
        const pSize = Store.data.size;
        Store.add(Parser.extract(mode));
        Store.clean();
        if (Store.data.size === pSize && ++idle > 3) break; else idle = 0;
        window.scrollBy(0, window.innerHeight * 0.8);
        await new Promise(r => setTimeout(r, 1200));
      }
      Store.isScrolling = false; ACTIONS.exec(Store.data, mode);
    }
  };

  const svg = d => `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="${d}"/></svg>`;
  
  const MENU_SCHEMA = [
    { type: "toggle", opts: ["JSON(L)", "CSV"] },
    { type: "separator" },
    { type: "action", ctx: "timeline", icon: svg("M14 21C13.4477 21 13 20.5523 13 20V12C13 11.4477 13.4477 11 14 11H20C20.5523 11 21 11.4477 21 12V20C21 20.5523 20.5523 21 20 21H14ZM4 13C3.44772 13 3 12.5523 3 12V4C3 3.44772 3.44772 3 4 3H10C10.5523 3 11 3.44772 11 4V12C11 12.5523 10.5523 13 10 13H4ZM9 11V5H5V11H9ZM4 21C3.44772 21 3 20.5523 3 20V16C3 15.4477 3.44772 15 4 15H10C10.5523 15 11 15.4477 11 16V20C11 20.5523 10.5523 21 10 21H4ZM5 19H9V17H5V19ZM15 19H19V13H15V19ZM13 4C13 3.44772 13.4477 3 14 3H20C20.5523 3 21 3.44772 21 4V8C21 8.55228 20.5523 9 20 9H14C13.4477 9 13 8.55228 13 8V4ZM15 5V7H19V5H15Z"), label: "Dump Visible Timeline", action: () => ACTIONS.dump('timeline') },
    { type: "action", ctx: "timeline", icon: svg("M12 2C17.5228 2 22 6.47715 22 12C22 17.5228 17.5228 22 12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2ZM12.1597 16C10.1243 16 8.29182 16.8687 7.01276 18.2556C8.38039 19.3474 10.114 20 12 20C13.9695 20 15.7727 19.2883 17.1666 18.1081C15.8956 16.8074 14.1219 16 12.1597 16ZM12 4C7.58172 4 4 7.58172 4 12C4 13.8106 4.6015 15.4807 5.61557 16.8214C7.25639 15.0841 9.58144 14 12.1597 14C14.6441 14 16.8933 15.0066 18.5218 16.6342C19.4526 15.3267 20 13.7273 20 12C20 7.58172 16.4183 4 12 4ZM12 5C14.2091 5 16 6.79086 16 9C16 11.2091 14.2091 13 12 13C9.79086 13 8 11.2091 8 9C8 6.79086 9.79086 5 12 5ZM12 7C10.8954 7 10 7.89543 10 9C10 10.1046 10.8954 11 12 11C13.1046 11 14 10.1046 14 9C14 7.89543 13.1046 7 12 7Z"), label: "Dump Profile Data", action: () => ACTIONS.exec(Parser.profile(), 'profile') },
    { type: "action", ctx: "timeline", icon: svg("M12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2C17.5228 2 22 6.47715 22 12C22 17.5228 17.5228 22 12 22ZM12 20C16.4183 20 20 16.4183 20 12C20 7.58172 16.4183 4 12 4C7.58172 4 4 7.58172 4 12C4 16.4183 7.58172 20 12 20ZM10.6219 8.41459L15.5008 11.6672C15.6846 11.7897 15.7343 12.0381 15.6117 12.2219C15.5824 12.2658 15.5447 12.3035 15.5008 12.3328L10.6219 15.5854C10.4381 15.708 10.1897 15.6583 10.0672 15.4745C10.0234 15.4088 10 15.3316 10 15.2526V8.74741C10 8.52649 10.1791 8.34741 10.4 8.34741C10.479 8.34741 10.5562 8.37078 10.6219 8.41459Z"), label: "Start Auto-Scroll", keepOpen: true, action: () => ACTIONS.scroll('timeline') },
    { type: "action", ctx: "thread", icon: svg("M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z"), label: "Dump Visible Thread", action: () => ACTIONS.dump('thread') },
    { type: "action", ctx: "thread", icon: svg("M12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2C17.5228 2 22 6.47715 22 12C22 17.5228 17.5228 22 12 22ZM12 20C16.4183 20 20 16.4183 20 12C20 7.58172 16.4183 4 12 4C7.58172 4 4 7.58172 4 12C4 16.4183 7.58172 20 12 20ZM10.6219 8.41459L15.5008 11.6672C15.6846 11.7897 15.7343 12.0381 15.6117 12.2219C15.5824 12.2658 15.5447 12.3035 15.5008 12.3328L10.6219 15.5854C10.4381 15.708 10.1897 15.6583 10.0672 15.4745C10.0234 15.4088 10 15.3316 10 15.2526V8.74741C10 8.52649 10.1791 8.34741 10.4 8.34741C10.479 8.34741 10.5562 8.37078 10.6219 8.41459Z"), label: "Start Auto-Scroll Thread", keepOpen: true, action: () => ACTIONS.scroll('thread') },
    { type: "action", icon: svg("M12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2C17.5228 2 22 6.47715 22 12C22 17.5228 17.5228 22 12 22ZM12 20C16.4183 20 20 16.4183 20 12C20 7.58172 16.4183 4 12 4C7.58172 4 4 7.58172 4 12C4 16.4183 7.58172 20 12 20ZM9 9H15V15H9V9Z"), label: "Stop & Save", action: () => Store.isScrolling = false },
    { type: "separator" },
    { type: "action", icon: svg("M12 13.9142L16.7929 18.7071L18.2071 17.2929L12 11.0858L5.79289 17.2929L7.20711 18.7071L12 13.9142ZM6 7L18 7V9L6 9L6 7Z"), label: "Go Top", action: () => window.scrollTo({ top: 0, behavior: "smooth" }) },
    { type: "action", icon: svg("M12 2C17.5228 2 22 6.47715 22 12C22 17.5228 17.5228 22 12 22C6.47715 22 2 17.5228 2 12H4C4 16.4183 7.58172 20 12 20C16.4183 20 20 16.4183 20 12C20 7.58172 16.4183 4 12 4C9.25022 4 6.82447 5.38734 5.38451 7.50024L8 7.5V9.5H2V3.5H4L3.99989 5.99918C5.82434 3.57075 8.72873 2 12 2ZM13 7L12.9998 11.585L16.2426 14.8284L14.8284 16.2426L10.9998 12.413L11 7H13Z"), label: "Changelog", action: () => Modal.open() },
    { type: "action", icon: svg("M12.001 2C6.47598 2 2.00098 6.475 2.00098 12C2.00098 16.425 4.86348 20.1625 8.83848 21.4875C9.33848 21.575 9.52598 21.275 9.52598 21.0125C9.52598 20.775 9.51348 19.9875 9.51348 19.15C7.00098 19.6125 6.35098 18.5375 6.15098 17.975C6.03848 17.6875 5.55098 16.8 5.12598 16.5625C4.77598 16.375 4.27598 15.9125 5.11348 15.9C5.90098 15.8875 6.46348 16.625 6.65098 16.925C7.55098 18.4375 8.98848 18.0125 9.56348 17.75C9.65098 17.1 9.91348 16.6625 10.201 16.4125C7.97598 16.1625 5.65098 15.3 5.65098 11.475C5.65098 10.3875 6.03848 9.4875 6.67598 8.7875C6.57598 8.5375 6.22598 7.5125 6.77598 6.1375C6.77598 6.1375 7.61348 5.875 9.52598 7.1625C10.326 6.9375 11.176 6.825 12.026 6.825C12.876 6.825 13.726 6.9375 14.526 7.1625C16.4385 5.8625 17.276 6.1375 17.276 6.1375C17.826 7.5125 17.476 8.5375 17.376 8.7875C18.0135 9.4875 18.401 10.375 18.401 11.475C18.401 15.3125 16.0635 16.1625 13.8385 16.4125C14.201 16.725 14.5135 17.325 14.5135 18.2625C14.5135 19.6 14.501 20.675 14.501 21.0125C14.501 21.275 14.6885 21.5875 15.1885 21.4875C19.259 20.1133 21.9999 16.2963 22.001 12C22.001 6.475 17.526 2 12.001 2Z"), label: "View on GitHub", action: () => window.open(CONFIG.repoUrl, "_blank") },
    { type: "action", icon: svg("M14.45 19L12 22.5L9.55 19H3C2.73478 19 2.48043 18.8946 2.29289 18.7071C2.10536 18.5196 2 18.2652 2 18V4C2 3.73478 2.10536 3.48043 2.29289 3.29289C2.48043 3.10536 2.73478 3 3 3H21C21.2652 3 21.5196 3.10536 21.7071 3.29289C21.8946 3.48043 22 3.73478 22 4V18C22 18.2652 21.8946 18.5196 21.7071 18.7071C21.5196 18.8946 21.2652 19 21 19H14.45ZM13.409 17H20V5H4V17H10.591L12 19.012L13.409 17Z"), label: "Issues", action: () => window.open(CONFIG.issuesUrl, "_blank") },
    { type: "action", icon: svg("M12.998 2V3H19.998V5H12.998V19H16.998V21H6.99805V19H10.998V5H3.99805V3H10.998V2H12.998ZM4.99805 6.34315L7.82647 9.17157C8.55033 9.89543 8.99805 10.8954 8.99805 12C8.99805 14.2091 7.20719 16 4.99805 16C2.78891 16 0.998047 14.2091 0.998047 12C0.998047 10.8954 1.44576 9.89543 2.16962 9.17157L4.99805 6.34315ZM18.998 6.34315L21.8265 9.17157C22.5503 9.89543 22.998 10.8954 22.998 12C22.998 14.2091 21.2072 16 18.998 16C16.7889 16 14.998 14.2091 14.998 12C14.998 10.8954 15.4458 9.89543 16.1696 9.17157L18.998 6.34315ZM4.99805 9.17157L3.58383 10.5858C3.20988 10.9597 2.99805 11.4606 2.99805 12C2.99805 13.1046 3.89348 14 4.99805 14C6.10262 14 6.99805 13.1046 6.99805 12C6.99805 11.4606 6.78621 10.9597 6.41226 10.5858L4.99805 9.17157ZM18.998 9.17157L17.5838 10.5858C17.2099 10.9597 16.998 11.4606 16.998 12C16.998 13.1046 17.8935 14 18.998 14C20.1026 14 20.998 13.1046 20.998 12C20.998 11.4606 20.7862 10.9597 20.4123 10.5858L18.998 9.17157Z"), label: "License", action: () => window.open(CONFIG.licenseUrl, "_blank") }
  ];

  const UI = {
    menu: null,
    items: [],
    init() {
      const style = document.createElement("style");
      style.textContent = `.x-archiver-menu{position:fixed;display:none;flex-direction:column;z-index:9999;background:var(--colors-background,#fff);color:var(--colors-text,#0f1419);border:1px solid var(--colors-border,#eff3f4);border-radius:12px;box-shadow:rgba(101,119,134,0.2) 0 0 15px,rgba(101,119,134,0.15) 0 0 3px 1px;padding:8px 0;min-width:200px;margin:0;list-style:none;font-size:15px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;overflow:hidden}.x-archiver-menu .x-am-action{display:flex;align-items:center;gap:12px;padding:10px 16px;cursor:pointer;transition:background .2s;font-weight:700}.x-archiver-menu .x-am-action:hover{background:rgba(15,20,25,.08)}.x-archiver-menu .x-am-icon{display:flex;align-items:center;justify-content:center;color:#536471;flex-shrink:0;transition:color .2s}.x-archiver-menu .x-am-action:hover .x-am-icon{color:inherit}.x-archiver-menu .x-am-sep{height:1px;background:var(--colors-border,#eff3f4);margin:4px 0}.x-archiver-menu .x-am-toggle{display:flex;align-items:center;padding:4px 12px;margin-bottom:4px;gap:12px}.x-archiver-menu .x-am-toggle-btns{display:flex;flex:1;gap:4px}.x-archiver-menu .x-am-toggle-btn{flex:1;padding:6px 0;text-align:center;font-size:13px;font-weight:700;border-radius:6px;cursor:pointer;transition:all .2s ease;color:#536471}.x-archiver-menu .x-am-toggle-btn:hover{background:rgba(15,20,25,.05)}.x-archiver-menu .x-am-toggle-btn.active{background:#1d9bf0;color:#fff}@media(prefers-color-scheme:dark){.x-archiver-menu{background:#000;border-color:#2f3336;color:#e7e9ea;box-shadow:rgba(255,255,255,0.2) 0 0 15px,rgba(255,255,255,0.15) 0 0 3px 1px}.x-archiver-menu .x-am-action:hover{background:rgba(255,255,255,.08)}.x-archiver-menu .x-am-icon{color:#71767b}.x-archiver-menu .x-am-sep{background:#2f3336}.x-archiver-menu .x-am-toggle-btn{color:#71767b}.x-archiver-menu .x-am-toggle-btn:hover{background:rgba(255,255,255,.05)}.x-archiver-menu .x-am-toggle-btn.active{background:#1d9bf0;color:#fff}}`;
      document.head.appendChild(style);

      this.menu = document.createElement("menu");
      this.menu.className = "x-archiver-menu";
      MENU_SCHEMA.forEach(i => {
        let el;
        if (i.type === "separator") {
          el = document.createElement("div"); el.className = "x-am-sep";
        } else if (i.type === "action") {
          el = document.createElement("li"); el.className = "x-am-action";
          el.innerHTML = `<span class="x-am-icon">${i.icon}</span><span class="x-am-label">${i.label}</span>`;
          el.onclick = e => { e.stopPropagation(); if (!i.keepOpen) this.hide(); i.action(); };
        } else if (i.type === "toggle") {
          el = document.createElement("div"); el.className = "x-am-toggle";
          const group = document.createElement("div"); group.className = "x-am-toggle-btns";
          i.opts.forEach(opt => {
            const btn = document.createElement("div");
            btn.className = `x-am-toggle-btn ${State.format === opt ? 'active' : ''}`; btn.innerText = opt;
            btn.onclick = e => { e.stopPropagation(); State.format = opt; DOM.qa('.x-am-toggle-btn', group).forEach(b => b.classList.toggle('active', b.innerText === opt)); };
            group.appendChild(btn);
          });
          el.appendChild(group);
        }
        this.menu.appendChild(el);
        this.items.push({ el, ctx: i.ctx });
      });
      document.body.appendChild(this.menu);
      document.addEventListener("click", () => this.hide());
    },
    show(ctx, t) {
      this.items.forEach(i => i.el.style.display = (i.ctx && i.ctx !== ctx) ? "none" : "");
      const r = t.getBoundingClientRect();
      const leftPos = Math.max(8, r.left - 100);
      this.menu.style.display = "flex"; this.menu.style.top = `${r.bottom + 8}px`; this.menu.style.left = `${leftPos}px`;
    },
    hide() { if (this.menu) this.menu.style.display = "none"; }
  };

  const Lifecycle = {
    observerLock: false,
    injectMenu() {
      if (DOM.q('[data-injector="archiver-menu"]')) return;

      let refBtn = null;
      let targetGroup = null;

      const topNav = DOM.q('[data-testid="TopNavBar"]');
      if (topNav) {
        const btns = DOM.qa('button', topNav);
        refBtn = btns.find(b => ['搜索', 'Search'].includes(b.getAttribute('aria-label')));
        if (!refBtn && btns.length > 0) refBtn = btns[btns.length - 1];
        if (refBtn) targetGroup = refBtn.parentElement;
      }

      if (!targetGroup) {
        const h2 = DOM.q('[data-testid="primaryColumn"] h2');
        if (h2) {
          let midCol = h2;
          while (midCol && midCol.parentElement && midCol.parentElement.children.length !== 3) {
            if (midCol.tagName === 'BODY') break;
            midCol = midCol.parentElement;
          }
          const rightCol = midCol?.nextElementSibling;
          if (rightCol) {
            targetGroup = rightCol;
            while (targetGroup.children.length === 1 && targetGroup.firstElementChild.tagName === 'DIV') {
              targetGroup = targetGroup.firstElementChild;
            }
            refBtn = DOM.q('button', targetGroup) || DOM.q('a[role="link"]', targetGroup);
          }
        }
      }

      if (!refBtn || !targetGroup) return;

      const btn = refBtn.cloneNode(true);
      btn.setAttribute("aria-label", "Archive Menu");
      btn.setAttribute("data-injector", "archiver-menu");
      btn.removeAttribute("data-testid");

      const _svg = DOM.q("svg", btn);
      if (_svg) _svg.setAttribute("viewBox", "0 0 24 24");

      const p = DOM.q("path", btn);
      if (p) p.setAttribute("d", "M10.9999 2.04938L11 4.06188C7.05371 4.55396 4 7.92036 4 12C4 16.4183 7.58172 20 12 20C13.8487 20 15.5509 19.3729 16.9055 18.3199L18.3289 19.7428C16.605 21.1536 14.4014 22 12 22C6.47715 22 2 17.5228 2 12C2 6.81468 5.94662 2.55115 10.9999 2.04938ZM21.9506 13.0001C21.7509 15.0111 20.9555 16.8468 19.7433 18.3283L18.3199 16.9055C19.1801 15.799 19.756 14.4606 19.9381 12.9999L21.9506 13.0001ZM13.0011 2.04948C17.725 2.51902 21.4815 6.27589 21.9506 10.9999L19.9381 11C19.4869 7.38162 16.6192 4.51364 13.001 4.062L13.0011 2.04948Z");

      btn.onclick = e => { e.preventDefault(); e.stopPropagation(); UI.show('timeline', btn); };

      targetGroup.insertBefore(btn, targetGroup.firstChild);
    },
    injectThread() {
      const tweets = DOM.qa('article[data-testid="tweet"]');
      for (const t of tweets) {
        if (DOM.q('[data-injector="archiver-thread"]', t)) continue;
        const a = DOM.q('button[data-testid="caret"]', t);
        if (!a) continue;
        const btn = document.createElement('button');
        btn.setAttribute('data-injector', 'archiver-thread');
        Object.assign(btn.style, { background: 'transparent', border: 'none', cursor: 'pointer', padding: '8px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background-color 0.2s ease', outline: 'none', color: '#71767b' });

        btn.innerHTML = `<svg viewBox="0 0 24 24" width="1.25em" height="1.25em" fill="currentColor"><path d="M10.9999 2.04938L11 4.06188C7.05371 4.55396 4 7.92036 4 12C4 16.4183 7.58172 20 12 20C13.8487 20 15.5509 19.3729 16.9055 18.3199L18.3289 19.7428C16.605 21.1536 14.4014 22 12 22C6.47715 22 2 17.5228 2 12C2 6.81468 5.94662 2.55115 10.9999 2.04938ZM21.9506 13.0001C21.7509 15.0111 20.9555 16.8468 19.7433 18.3283L18.3199 16.9055C19.1801 15.799 19.756 14.4606 19.9381 12.9999L21.9506 13.0001ZM13.0011 2.04948C17.725 2.51902 21.4815 6.27589 21.9506 10.9999L19.9381 11C19.4869 7.38162 16.6192 4.51364 13.001 4.062L13.0011 2.04948Z"></path></svg>`;

        btn.onmouseenter = () => btn.style.backgroundColor = 'rgba(113, 118, 123, 0.1)';
        btn.onmouseleave = () => btn.style.backgroundColor = 'transparent';
        btn.onclick = e => { e.preventDefault(); e.stopPropagation(); UI.show('thread', btn); };
        a.parentElement.insertBefore(btn, a);
      }
    },
    observe() {
      new MutationObserver(() => {
        if (this.observerLock) return;
        this.observerLock = true;
        requestAnimationFrame(() => {
          this.injectMenu();
          this.injectThread();
          this.observerLock = false;
        });
      }).observe(document.body, { childList: true, subtree: true });
    }
  };

  UI.init();
  Lifecycle.observe();
})();
