# X (Twitter) Timeline Archiver

<img src="https://abs.twimg.com/favicons/twitter.3.ico" align="right" alt="x-logo" />

极简的 X (Twitter) 时间线归档工具。

---

**特性:**

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/miniyu157/x-timeline-archiver/main/assets/dark.png">
  <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/miniyu157/x-timeline-archiver/main/assets/light.png">
  <img src="https://raw.githubusercontent.com/miniyu157/x-timeline-archiver/main/assets/light.png" align="right" alt="preview" />
</picture>

- 极简、纯粹的逻辑与交互，代码行数 300 左右（LOC）；
- 针对于 X 页面的虚拟节点，提供滚动功能便捷获取时间线；
- 输出格式为 JSON/(L) 或 CSV，一行一个帖子。  
基础数据包含点赞、转贴、收藏、查看、书签、URL，并区分转贴、引用，  
其中推文串不进行特殊处理，引用帖子无法获取 URL；
- 提供实用功能，例如获取账户信息、返回顶部等。

**交互:**

- 融入 X 网页 UI，支持自动深色切换。

**入口:**

- 账号页面顶部 Grok 附近的按钮。
