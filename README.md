# X (Twitter) Timeline Archiver

极简的 X (Twitter) 时间线归档工具。

---

**特性:**

- 极简、纯粹的逻辑与交互，代码行数 300 左右（LOC）；
- 针对于 X 页面的虚拟节点，提供滚动功能便捷获取时间线；
- 输出格式为 JSONL，一个 JSON 一个帖子。  
基础数据包含点赞、转贴、收藏、查看、书签、URL，并区分转贴、引用，  
其中推文串不进行特殊处理，引用帖子无法获取 URL。

**入口:**

- 账号页面顶部 Grok 附近的按钮

**预览:**

![menu](https://raw.githubusercontent.com/miniyu157/x-timeline-archiver/main/assets/menu.png)
