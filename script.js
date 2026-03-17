// ==UserScript==
// @name         X (Twitter) Timeline Archiver
// @name:zh-CN   X (Twitter) 时间线归档助手
// @namespace    https://github.com/miniyu157/x-timeline-archiver
// @version      2026.3.17-2
// @description  Elegant and minimalist timeline archiver for X.
// @description:zh-CN 极简的 X (Twitter) 时间线归档工具。
// @author       Yumeka
// @license      MIT
// @match        *://x.com/*
// @match        *://twitter.com/*
// @icon         https://abs.twimg.com/favicons/twitter.3.ico
// @grant        GM_addStyle
// @run-at       document-end
// ==/UserScript==

/*
  X (Twitter) Timeline Archiver
      2026.3.17-2 更新日志
  - feat: 添加导出格式菜单 JSON(L)/CSV；
  - feat!: 移除 lang 字段；
  - feat!: nickname 字段由包含昵称+ID, 改为仅包含昵称；
  - style: 代码风格变得更加紧凑。

      2026.3.17 更新日志
  - feat: 新增 Dump Profile Data 功能；
  - feat: 新增抓取页面的多语言支持；
  - feat: 下载文件时的友好文件名；

      2026.3.16 更新日志
  - init: 初始版本，功能不多，易维护。
*/

(() => {
  "use strict";

  const I18N = {
    replies: "回复|回覆|Replies|Reply|replies|reply",
    reposts: "次转帖|次轉發|reposts|Reposts|repost|Repost",
    likes: "喜欢次数|喜欢|個喜歡|Likes|Like|likes|like",
    bookmarks: "书签|個書籤|Bookmarks|Bookmark|bookmarks|bookmark",
    views: "次观看|次查看|次觀看|views|Views|view|View",
    search: "搜索|搜尋|Search"
  };

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
    f: (ext, isP) => `X_${isP ? "Profile" : "Timeline"}_${Fmt.i()}_${Fmt.d()}.${ext}`
  };

  const Store = {
    data: new Map(),
    isScrolling: false,
    add(arr) { arr.forEach(e => e?.id && this.data.set(e.id, JSON.stringify(e))); },
    clear() { this.data.clear(); }
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
      profile: { ext: "json", mime: "application/json", parse: d => JSON.stringify(d, null, 2) }
    },
    "CSV": {
      timeline: { ext: "csv", mime: "text/csv;charset=utf-8;", parse: m => toCSV([...m.values()].map(JSON.parse)) },
      profile: { ext: "csv", mime: "text/csv;charset=utf-8;", parse: d => toCSV([d]) }
    }
  };

  const Parser = {
    user: (n) => {
      if (!n) return null;
      const nick = DOM.qa("a:first-child span, a:first-child img", n).reduce((a, e) => e.tagName === "IMG" ? a + (e.getAttribute("alt") || "") : e.tagName === "SPAN" && !e.children.length && !e.textContent.startsWith("@") ? a + e.textContent : a, "");      return { nickname: nick.trim(), handle: DOM.qa("span", n).find(s => s.textContent.startsWith("@"))?.textContent };
    },
    metrics: (s) => {
      if (!s) return null;
      const ex = kw => { const m = s.match(new RegExp(`([\\d,]+)\\s*(?:${kw})`, "i")); return m ? Number(m[1].replace(/,/g, "")) : 0; };
      return { replies: ex(I18N.replies), retweets: ex(I18N.reposts), likes: ex(I18N.likes), bookmarks: ex(I18N.bookmarks), views: ex(I18N.views) };
    },
    entity: (n) => {
      const u = DOM.qa('[data-testid="User-Name"]', n), t = DOM.qa('[data-testid="tweetText"]', n), tm = DOM.qa("time", n),
            a = DOM.qa('[data-testid="Tweet-User-Avatar"] img', n), m = DOM.qa('[data-testid="tweetPhoto"] img', n).map(i => i.src),
            mn = DOM.qa("div", n).find(d => new RegExp(I18N.views, "i").test(d.getAttribute("aria-label") || ""));
      const p = (i) => {
        if (!tm[i] && !t[i]) return null;
        const url = tm[i]?.closest("a")?.getAttribute("href") || null;
        return { id: url?.split("/").pop() || null, url, time: tm[i]?.getAttribute("datetime") || null, content: t[i]?.textContent.trim() || null, author: { avatar: a[i]?.src || null, ...Parser.user(u[i]) } };
      };
      const main = p(0) || {};
      return { id: main.id, url: main.url, isRetweet: !!DOM.q('[data-testid="socialContext"]', n), time: main.time, content: main.content, media: m.length ? m : null, author: main.author, quote: p(1), metrics: Parser.metrics(mn?.getAttribute("aria-label")) };
    },
    extractVisible: () => DOM.qa('article[data-testid="tweet"]').map(Parser.entity),
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
    }
  };

  const ACTIONS = {
    exec: (data, isProfile) => {
      if (!data || (isProfile && !data.handle && !data.displayName)) return;
      const conf = Exporters[State.format][isProfile ? "profile" : "timeline"];
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([conf.parse(data)], { type: conf.mime }));
      a.download = Fmt.f(conf.ext, isProfile);
      a.click();
      URL.revokeObjectURL(a.href);
    }
  };

  const MENU_SCHEMA = [
    { type: "toggle", opts: ["JSON(L)", "CSV"], bind: () => State.format, onChange: v => State.format = v },
    { type: "separator" },
    { type: "action", label: "Dump Visible Timeline", action: () => { Store.clear(); Store.add(Parser.extractVisible()); ACTIONS.exec(Store.data, false); } },
    { type: "action", label: "Dump Profile Data", action: () => ACTIONS.exec(Parser.profile(), true) },
    { type: "action", label: "Start Auto-Scroll", keepOpen: true, action: async () => {
      if (Store.isScrolling) return;
      Store.clear(); Store.isScrolling = true; let idle = 0;
      while (Store.isScrolling) {
        const pSize = Store.data.size;
        Store.add(Parser.extractVisible());
        if (Store.data.size === pSize && ++idle > 3) break; else idle = 0;
        window.scrollBy(0, window.innerHeight * 0.8);
        await new Promise(r => setTimeout(r, 1200));
      }
      Store.isScrolling = false; ACTIONS.exec(Store.data, false);
    }},
    { type: "action", label: "Stop & Save", action: () => Store.isScrolling = false },
    { type: "separator" },
    { type: "action", label: "Go Top", action: () => window.scrollTo({ top: 0, behavior: "smooth" }) },
    { type: "action", label: "View on GitHub", action: () => window.open(CONFIG.repoUrl, "_blank") },
    { type: "action", label: "License", action: () => window.open(CONFIG.licenseUrl, "_blank") }
  ];

  const UI = {
    menu: null,
    init() {
      const style = document.createElement("style");
      style.textContent = `
        .x-archiver-menu{position:fixed;display:none;flex-direction:column;z-index:9999;background:var(--colors-background,#fff);color:var(--colors-text,#0f1419);border:1px solid var(--colors-border,#eff3f4);border-radius:12px;box-shadow:rgba(101,119,134,0.2) 0 0 15px,rgba(101,119,134,0.15) 0 0 3px 1px;padding:8px 0;min-width:180px;margin:0;list-style:none;font-size:15px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;overflow:hidden}
        .x-archiver-menu .x-am-action{padding:12px 16px;cursor:pointer;transition:background .2s;font-weight:700}
        .x-archiver-menu .x-am-action:hover{background:rgba(15,20,25,.08)}
        .x-archiver-menu .x-am-sep{height:1px;background:var(--colors-border,#eff3f4);margin:4px 0}
        .x-archiver-menu .x-am-toggle{display:flex;padding:4px 12px;margin-bottom:4px;gap:4px}
        .x-archiver-menu .x-am-toggle-btn{flex:1;padding:6px 0;text-align:center;font-size:13px;font-weight:700;border-radius:6px;cursor:pointer;transition:all .2s ease;color:#536471}
        .x-archiver-menu .x-am-toggle-btn:hover{background:rgba(15,20,25,.05)}
        .x-archiver-menu .x-am-toggle-btn.active{background:#1d9bf0;color:#fff}
        @media(prefers-color-scheme:dark){.x-archiver-menu{background:#000;border-color:#2f3336;color:#e7e9ea;box-shadow:rgba(255,255,255,0.2) 0 0 15px,rgba(255,255,255,0.15) 0 0 3px 1px}.x-archiver-menu .x-am-action:hover{background:rgba(255,255,255,.08)}.x-archiver-menu .x-am-sep{background:#2f3336}.x-archiver-menu .x-am-toggle-btn{color:#71767b}.x-archiver-menu .x-am-toggle-btn:hover{background:rgba(255,255,255,.05)}.x-archiver-menu .x-am-toggle-btn.active{background:#1d9bf0;color:#fff}}
      `;
      document.head.appendChild(style);

      this.menu = document.createElement("menu");
      this.menu.className = "x-archiver-menu";
      MENU_SCHEMA.forEach(i => {
        if (i.type === "separator") {
          const sep = document.createElement("div");
          sep.className = "x-am-sep";
          this.menu.appendChild(sep);
        } else if (i.type === "action") {
          const li = document.createElement("li");
          li.className = "x-am-action"; li.innerText = i.label;
          li.onclick = e => { e.stopPropagation(); if (!i.keepOpen) this.hide(); i.action(); };
          this.menu.appendChild(li);
        } else if (i.type === "toggle") {
          const c = document.createElement("div"); c.className = "x-am-toggle";
          i.opts.forEach(opt => {
            const btn = document.createElement("div");
            btn.className = `x-am-toggle-btn ${i.bind() === opt ? 'active' : ''}`; btn.innerText = opt;
            btn.onclick = e => { e.stopPropagation(); DOM.qa(".x-am-toggle-btn", c).forEach(b => b.classList.remove("active")); btn.classList.add("active"); i.onChange(opt); };
            c.appendChild(btn);
          });
          this.menu.appendChild(c);
        }
      });
      document.body.appendChild(this.menu);
      document.addEventListener("click", () => this.hide());
    },
    show(t) {
      const r = t.getBoundingClientRect();
      this.menu.style.display = "flex"; this.menu.style.top = `${r.bottom + 8}px`; this.menu.style.left = `${r.left - 100}px`;
    },
    hide() { if (this.menu) this.menu.style.display = "none"; }
  };

  const Lifecycle = {
    inject() {
      if (DOM.q('[data-injector="archiver"]')) return;
      const ref = DOM.q(I18N.search.split("|").map(s => `button[aria-label="${s}"]`).join(", "));
      if (!ref) return;
      const btn = ref.cloneNode(true);
      btn.setAttribute("aria-label", "Archive"); btn.setAttribute("data-injector", "archiver");
      const p = DOM.q("path", btn);
      if (p) p.setAttribute("d", "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11h-4v4h-2v-4H7v-2h4V7h2v4h4v2z");
      btn.onclick = e => { e.preventDefault(); e.stopPropagation(); UI.show(btn); };
      ref.parentElement.insertBefore(btn, ref);
    },
    observe() { new MutationObserver(() => this.inject()).observe(document.body, { childList: true, subtree: true }); }
  };

  UI.init();
  Lifecycle.observe();
})();
