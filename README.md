# Ice-Harness OPC

Ice-Harness OPC 现在按多环境工作区拆分，避免本地稳定实验、公网演示和新功能实验互相污染。

## 工作区结构

- `stable-local/`：本地稳定实验版，保留原始 UI 和实验室日常工作流，不包含 demo onboarding。
- `public-demo/`：GitHub Pages 公网演示版，包含一键 Demo、示例 Prompt 和首次体验引导。
- `experimental/`：AI Agent、新 UI、WebSocket、MCP 等不稳定功能实验区。
- `demo-data/`：公开演示数据、未来 demo CSV、示例截图和 sample report。
- `docs/`：演示文档、比赛材料、架构图、roadmap 和 onboarding 文档。

## 公网演示

公网演示版本以 `public-demo/` 为主版本。GitHub Pages workflow 会把 `public-demo/` 构建为站点根目录，并把 `demo-data/` 一起复制到发布产物中。

在线访问地址：

```text
https://austin-ding99.github.io/ice-harness-opc/
```

首次体验路径：

1. 打开公网演示页。
2. 点击「加载示例数据」。
3. 页面自动读取 `demo-data/refrigerator_demo.csv`。
4. 数据按本地实验版的监控节奏随时间滚动，不再一次性铺满图表。
5. 点击示例 Prompt 体验自然语言控制。
6. 打开 `cloud_sheet.html`，标记曲线并导出 PPTX。

内置示例 Prompt：

- `cut the data above 150`
- `hide bad channels`
- `show ice membrane temperature`

## 本地稳定实验

本地实验室日常使用请进入 `stable-local/`：

```bash
cd stable-local
python3 -m http.server 8000
```

然后访问：

```text
http://localhost:8000/
```

详细说明见 `stable-local/README_LOCAL.md`。

## 实验开发

新能力原型请放入 `experimental/`，例如 WebSocket、MCP、多 Agent、自动预警和新 UI。稳定后再评估是否迁移到 `stable-local/` 或 `public-demo/`。

## 数据与隐私

`.gitignore` 默认排除 CSV/TSV/XLSX/XLS 和生成的 PPTX，避免误提交实验原始数据。公开演示例外数据为：

```text
demo-data/refrigerator_demo.csv
```

不要把真实 API Key 写入源码。当前 DeepSeek API Key 仍由使用者在浏览器中输入并保存在本地 `localStorage`。
