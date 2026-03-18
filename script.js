// ==UserScript==
// @name         X (Twitter) Timeline & Thread Archiver
// @name:zh-CN   X (Twitter) 时间线与帖子归档助手
// @namespace    https://github.com/miniyu157/x-timeline-archiver
// @version      v2026.3.18.2
// @description  Elegant and minimalist timeline & thread archiver for X.
// @description:zh-CN 优雅极简的 X (Twitter) 时间线与帖子归档工具。
// @author       Yumeka
// @license      MIT
// @match        *://x.com/*
// @match        *://twitter.com/*
// @icon         https://abs.twimg.com/favicons/twitter.3.ico
// @grant        GM_addStyle
// @run-at       document-end
// ==/UserScript==

/*
  X (Twitter) Timeline Archiver 更新日志
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
    async fetch() {
      if (this.data) return this.data;
      if (this.fetching) return [];
      this.fetching = true;
      try {
        const repoPath = CONFIG.repoUrl.replace("https://github.com/", "");
        const res = await fetch(`https://api.github.com/repos/${repoPath}/tags?per_page=5`);
        const tags = await res.json();
        this.data = await Promise.all(tags.map(async t => {
          const cRes = await fetch(t.commit.url);
          const cData = await cRes.json();
          return { v: t.name, m: cData.commit.message };
        }));
      } catch {
        this.data = [{ v: "Error", m: "Failed to fetch changelog." }];
      }
      this.fetching = false;
      return this.data;
    }
  };

  const Modal = {
    el: null,
    init() {
      const style = document.createElement("style");
      style.textContent = `.x-archiver-modal{padding:0;border:none;border-radius:16px;background:var(--colors-background,#fff);color:var(--colors-text,#0f1419);width:90%;max-width:560px;max-height:80vh;overscroll-behavior:contain;box-shadow:rgba(101,119,134,0.2) 0 0 15px,rgba(101,119,134,0.15) 0 0 3px 1px}.x-archiver-modal::backdrop{background:rgba(0,0,0,0.4);backdrop-filter:blur(4px)}.x-am-header{padding:16px 20px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--colors-border,#eff3f4);font-size:20px;font-weight:700}.x-am-close{cursor:pointer;background:0 0;border:none;font-size:24px;line-height:1;width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:inherit;transition:background .2s}.x-am-close:hover{background:rgba(15,20,25,.1)}.x-am-body{padding:20px;overflow-y:auto;max-height:calc(80vh - 69px);font-size:15px;line-height:1.5;white-space:pre-wrap;word-break:break-word}.x-am-item{margin-bottom:24px}.x-am-item:last-child{margin-bottom:0}.x-am-ver{font-size:17px;font-weight:700;color:#1d9bf0;margin-bottom:8px}@media(prefers-color-scheme:dark){.x-archiver-modal{background:#000;color:#e7e9ea;border:1px solid #2f3336;box-shadow:rgba(255,255,255,0.2) 0 0 15px,rgba(255,255,255,0.15) 0 0 3px 1px}.x-am-header{border-bottom-color:#2f3336}.x-am-close:hover{background:rgba(255,255,255,.1)}}`;
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
        const match = el?.getAttribute('aria-label')?.match(/([\d,]+)/);
        return match ? parseInt(match[1].replace(/,/g, ''), 10) : 0;
      };
      return {
        replies: ex('[data-testid="reply"]'),
        retweets: ex('[data-testid="retweet"], [data-testid="unretweet"]'),
        likes: ex('[data-testid="like"], [data-testid="unlike"]'),
        bookmarks: ex('[data-testid="bookmark"], [data-testid="removeBookmark"]'),
        views: ex('a[href$="/analytics"]')
      };
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
        const u = DOM.q('time', cl)?.closest('a');
        res.push({
          id: u?.href?.split('/').pop() || id, url: u?.href || null,
          context: DOM.q('[data-testid="socialContext"]', cl) ? Parser.tx(DOM.q('[data-testid="socialContext"]', cl)).trim() : null,
          time: DOM.q('time', cl)?.getAttribute('datetime') || null, author: Parser.au(cl),
          content: { text: DOM.q('[data-testid="tweetText"]', cl) ? Parser.tx(DOM.q('[data-testid="tweetText"]', cl)).trim() : null, media: DOM.qa('[data-testid="tweetPhoto"] img', cl).map(img => img.src) },
          quote: Parser.qt(cl), metrics: Parser.metrics(cl)
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

  const MENU_SCHEMA = [
    { type: "toggle", opts: ["JSON(L)", "CSV"] },
    { type: "separator" },
    { type: "action", ctx: "timeline", label: "Dump Visible Timeline", action: () => ACTIONS.dump('timeline') },
    { type: "action", ctx: "timeline", label: "Dump Profile Data", action: () => ACTIONS.exec(Parser.profile(), 'profile') },
    { type: "action", ctx: "timeline", label: "Start Auto-Scroll", keepOpen: true, action: () => ACTIONS.scroll('timeline') },
    { type: "action", ctx: "thread", label: "Dump Visible Thread", action: () => ACTIONS.dump('thread') },
    { type: "action", ctx: "thread", label: "Start Auto-Scroll Thread", keepOpen: true, action: () => ACTIONS.scroll('thread') },
    { type: "action", label: "Stop & Save", action: () => Store.isScrolling = false },
    { type: "separator" },
    { type: "action", label: "Go Top", action: () => window.scrollTo({ top: 0, behavior: "smooth" }) },
    { type: "action", label: "Changelog", action: () => Modal.open() },
    { type: "action", label: "View on GitHub", action: () => window.open(CONFIG.repoUrl, "_blank") },
    { type: "action", label: "License", action: () => window.open(CONFIG.licenseUrl, "_blank") }
  ];

  const UI = {
    menu: null,
    items: [],
    init() {
      const style = document.createElement("style");
      style.textContent = `.x-archiver-menu{position:fixed;display:none;flex-direction:column;z-index:9999;background:var(--colors-background,#fff);color:var(--colors-text,#0f1419);border:1px solid var(--colors-border,#eff3f4);border-radius:12px;box-shadow:rgba(101,119,134,0.2) 0 0 15px,rgba(101,119,134,0.15) 0 0 3px 1px;padding:8px 0;min-width:180px;margin:0;list-style:none;font-size:15px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;overflow:hidden}.x-archiver-menu .x-am-action{padding:12px 16px;cursor:pointer;transition:background .2s;font-weight:700}.x-archiver-menu .x-am-action:hover{background:rgba(15,20,25,.08)}.x-archiver-menu .x-am-sep{height:1px;background:var(--colors-border,#eff3f4);margin:4px 0}.x-archiver-menu .x-am-toggle{display:flex;padding:4px 12px;margin-bottom:4px;gap:4px}.x-archiver-menu .x-am-toggle-btn{flex:1;padding:6px 0;text-align:center;font-size:13px;font-weight:700;border-radius:6px;cursor:pointer;transition:all .2s ease;color:#536471}.x-archiver-menu .x-am-toggle-btn:hover{background:rgba(15,20,25,.05)}.x-archiver-menu .x-am-toggle-btn.active{background:#1d9bf0;color:#fff}@media(prefers-color-scheme:dark){.x-archiver-menu{background:#000;border-color:#2f3336;color:#e7e9ea;box-shadow:rgba(255,255,255,0.2) 0 0 15px,rgba(255,255,255,0.15) 0 0 3px 1px}.x-archiver-menu .x-am-action:hover{background:rgba(255,255,255,.08)}.x-archiver-menu .x-am-sep{background:#2f3336}.x-archiver-menu .x-am-toggle-btn{color:#71767b}.x-archiver-menu .x-am-toggle-btn:hover{background:rgba(255,255,255,.05)}.x-archiver-menu .x-am-toggle-btn.active{background:#1d9bf0;color:#fff}}`;
      document.head.appendChild(style);

      this.menu = document.createElement("menu");
      this.menu.className = "x-archiver-menu";
      MENU_SCHEMA.forEach(i => {
        let el;
        if (i.type === "separator") {
          el = document.createElement("div"); el.className = "x-am-sep";
        } else if (i.type === "action") {
          el = document.createElement("li"); el.className = "x-am-action"; el.innerText = i.label;
          el.onclick = e => { e.stopPropagation(); if (!i.keepOpen) this.hide(); i.action(); };
        } else if (i.type === "toggle") {
          el = document.createElement("div"); el.className = "x-am-toggle";
          i.opts.forEach(opt => {
            const btn = document.createElement("div");
            btn.className = `x-am-toggle-btn ${State.format === opt ? 'active' : ''}`; btn.innerText = opt;
            btn.onclick = e => { e.stopPropagation(); State.format = opt; DOM.qa('.x-am-toggle-btn', el).forEach(b => b.classList.toggle('active', b.innerText === opt)); };
            el.appendChild(btn);
          });
        }
        this.menu.appendChild(el);
        this.items.push({ el, ctx: i.ctx });
      });
      document.body.appendChild(this.menu);
      document.addEventListener("click", () => this.hide());
    },
    show(ctx, t) {
      this.items.forEach(i => i.el.style.display = (i.ctx && i.ctx !== ctx) ? "none" : (i.el.className.includes("toggle") ? "flex" : "block"));
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

      const svg = DOM.q("svg", btn);
      if (svg) svg.setAttribute("viewBox", "0 0 24 24");

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
