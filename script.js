// ==UserScript==
// @name         X (Twitter) Timeline Archiver
// @name:zh-CN   X (Twitter) 时间线归档助手
// @namespace    https://github.com/miniyu157/x-timeline-archiver
// @version      2026.3.16
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

(() => {
  "use strict";

  const CONFIG = {
    repoUrl: "https://github.com/miniyu157/x-timeline-archiver",
    licenseUrl:
      "https://github.com/miniyu157/x-timeline-archiver/blob/main/LICENSE",
  };

  const DOM = {
    q: (sel, ctx = document) => ctx.querySelector(sel),
    qa: (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel)),
  };

  const Formatters = {
    date: () => {
      const d = new Date();
      const p = (n) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}_${p(d.getMinutes())}_${p(d.getSeconds())}`;
    },
    filename: () => `X_Timeline_${Formatters.date()}.jsonl`,
  };

  const Store = {
    data: new Map(),
    isScrolling: false,
    add(entities) {
      entities.forEach((e) => {
        if (e && e.id) this.data.set(e.id, JSON.stringify(e));
      });
    },
    dump() {
      return Array.from(this.data.values()).join("\n");
    },
    clear() {
      this.data.clear();
    },
  };

  const Parser = {
    user: (node) => {
      if (!node) return null;
      const nameEls = DOM.qa("a:first-child span, a:first-child img", node);
      const nickname = nameEls.reduce((acc, el) => {
        if (el.tagName === "IMG") return acc + (el.getAttribute("alt") || "");
        if (el.tagName === "SPAN" && !el.children.length)
          return acc + el.textContent;
        return acc;
      }, "");
      const handle = DOM.qa("span", node).find((s) =>
        s.textContent.startsWith("@"),
      )?.textContent;
      return { nickname: nickname.trim(), handle };
    },
    metrics: (str) => {
      if (!str) return null;
      const ext = (kw) => {
        const m = str.match(new RegExp(`([\\d,]+)\\s*(?:${kw})`));
        return m ? Number(m[1].replace(/,/g, "")) : 0;
      };
      return {
        replies: ext("回复"),
        retweets: ext("次转帖"),
        likes: ext("喜欢次数|喜欢"),
        bookmarks: ext("书签"),
        views: ext("次观看|次查看"),
      };
    },
    entity: (node) => {
      const isRetweet = !!DOM.q('[data-testid="socialContext"]', node);
      const users = DOM.qa('[data-testid="User-Name"]', node);
      const texts = DOM.qa('[data-testid="tweetText"]', node);
      const times = DOM.qa("time", node);
      const avatars = DOM.qa('[data-testid="Tweet-User-Avatar"] img', node);
      const medias = DOM.qa('[data-testid="tweetPhoto"] img', node).map(
        (img) => img.src,
      );
      const metricsNode = DOM.qa("div", node).find((d) =>
        /观看|查看/.test(d.getAttribute("aria-label") || ""),
      );

      const parseInner = (idx) => {
        if (!times[idx] && !texts[idx]) return null;
        const url = times[idx]?.closest("a")?.getAttribute("href") || null;
        return {
          id: url?.split("/").pop() || null,
          url,
          time: times[idx]?.getAttribute("datetime") || null,
          content: texts[idx]?.textContent.trim() || null,
          lang: texts[idx]?.getAttribute("lang") || null,
          author: {
            avatar: avatars[idx]?.src || null,
            ...Parser.user(users[idx]),
          },
        };
      };

      const main = parseInner(0) || {};
      return {
        id: main.id,
        url: main.url,
        isRetweet,
        time: main.time,
        lang: main.lang,
        content: main.content,
        media: medias.length ? medias : null,
        author: main.author,
        quote: parseInner(1),
        metrics: Parser.metrics(metricsNode?.getAttribute("aria-label")),
      };
    },
    extractVisible: () =>
      DOM.qa('article[data-testid="tweet"]').map(Parser.entity),
  };

  const ACTIONS = {
    triggerDownload: (data) => {
      if (!data) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(
        new Blob([data], { type: "application/jsonl" }),
      );
      a.download = Formatters.filename();
      a.click();
      URL.revokeObjectURL(a.href);
    },
    dumpVisible: () => {
      Store.clear();
      Store.add(Parser.extractVisible());
      ACTIONS.triggerDownload(Store.dump());
    },
    startAutoScroll: async () => {
      if (Store.isScrolling) return;
      Store.clear();
      Store.isScrolling = true;
      let idle = 0;

      while (Store.isScrolling) {
        const prevSize = Store.data.size;
        Store.add(Parser.extractVisible());

        if (Store.data.size === prevSize) {
          idle++;
          if (idle > 3) break;
        } else {
          idle = 0;
        }

        window.scrollBy(0, window.innerHeight * 0.8);
        await new Promise((r) => setTimeout(r, 1200));
      }

      Store.isScrolling = false;
      ACTIONS.triggerDownload(Store.dump());
    },
    stopAutoScroll: () => {
      Store.isScrolling = false;
    },
    scrollToAbsoluteTop: () => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    openRepo: () => window.open(CONFIG.repoUrl, "_blank"),
    openLicense: () => window.open(CONFIG.licenseUrl, "_blank"),
  };

  const MENU_OPTIONS = [
    { label: "Dump Visible", action: ACTIONS.dumpVisible },
    {
      label: "Start Auto-Scroll",
      action: ACTIONS.startAutoScroll,
      keepOpen: true,
    },
    { label: "Stop & Save", action: ACTIONS.stopAutoScroll },
    { label: "Go Top", action: ACTIONS.scrollToAbsoluteTop },
    { label: "View on GitHub", action: ACTIONS.openRepo },
    { label: "License", action: ACTIONS.openLicense },
  ];

  const UI = {
    menu: null,
    init() {
      const style = document.createElement("style");
      style.textContent = `
                .x-archiver-menu {
                    position: fixed; display: none; flex-direction: column; z-index: 9999;
                    background: var(--colors-background, #fff); color: var(--colors-text, #0f1419);
                    border: 1px solid var(--colors-border, #eff3f4);
                    border-radius: 8px; box-shadow: rgba(101, 119, 134, 0.2) 0px 0px 15px, rgba(101, 119, 134, 0.15) 0px 0px 3px 1px;
                    padding: 6px 0; min-width: 160px; margin: 0; list-style: none; font-size: 15px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                }
                .x-archiver-menu li { padding: 12px 16px; cursor: pointer; transition: background 0.2s; font-weight: 700; }
                .x-archiver-menu li:hover { background: rgba(15, 20, 25, 0.1); }
                @media (prefers-color-scheme: dark) {
                    .x-archiver-menu { background: #000; border-color: #2f3336; color: #e7e9ea; box-shadow: rgba(255, 255, 255, 0.2) 0px 0px 15px, rgba(255, 255, 255, 0.15) 0px 0px 3px 1px; }
                    .x-archiver-menu li:hover { background: rgba(255, 255, 255, 0.1); }
                }
            `;
      document.head.appendChild(style);

      this.menu = document.createElement("menu");
      this.menu.className = "x-archiver-menu";
      MENU_OPTIONS.forEach(({ label, action, keepOpen }) => {
        const li = document.createElement("li");
        li.innerText = label;
        li.onclick = (e) => {
          e.stopPropagation();
          if (!keepOpen) this.hide();
          action();
        };
        this.menu.appendChild(li);
      });
      document.body.appendChild(this.menu);
      document.addEventListener("click", () => this.hide());
    },
    show(target) {
      const rect = target.getBoundingClientRect();
      this.menu.style.display = "flex";
      this.menu.style.top = `${rect.bottom + 8}px`;
      this.menu.style.left = `${rect.left - 100}px`;
    },
    hide() {
      if (this.menu) this.menu.style.display = "none";
    },
  };

  const Lifecycle = {
    inject() {
      if (DOM.q('[data-injector="archiver"]')) return;
      const targetRef = DOM.q(
        'button[aria-label="搜索"], button[aria-label="Search"]',
      );
      if (!targetRef) return;

      const container = targetRef.parentElement;
      const btn = targetRef.cloneNode(true);

      btn.setAttribute("aria-label", "Archive Timeline");
      btn.setAttribute("data-injector", "archiver");

      const path = DOM.q("path", btn);
      if (path) {
        path.setAttribute(
          "d",
          "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11h-4v4h-2v-4H7v-2h4V7h2v4h4v2z",
        );
      }

      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        UI.show(btn);
      });

      container.insertBefore(btn, targetRef);
    },
    observe() {
      const observer = new MutationObserver(() => this.inject());
      observer.observe(document.body, { childList: true, subtree: true });
    },
  };

  UI.init();
  Lifecycle.observe();
})();
