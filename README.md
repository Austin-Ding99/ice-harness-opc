# Ice-Harness OPC

Ice-Harness OPC 是一套面向制冷实验数据的静态 Web 控制台，用于 CSV/TSV 数据导入、通道筛选、异常点清洗、曲线切片、云端协同矩阵和 PPTX 诊断报告生成。

## 功能概览

- `index.html`：主控台，支持实验数据导入、曲线监控、坏点清洗、自然语言控制和智能诊断入口。
- `cloud_sheet.html`：云端切片协同矩阵，支持多切片对比、标记、统计和 PPTX 导出。
- `agent_*.js`：数据提取、监控、清洗、监督和报告相关 Agent 逻辑。
- `refrigerator_demo.csv`：首次体验内置样例数据，用于 GitHub Pages 一键演示。

## 1 分钟 Demo 路线

打开在线页面后，点击首页的「立即体验 Demo」按钮即可自动读取 `refrigerator_demo.csv`，初始化默认通道，并一次性渲染完整样例曲线。

推荐演示流程：

1. 点击「立即体验 Demo」加载样例数据。
2. 在左侧通道控制矩阵中勾选或取消通道。
3. 点击示例 Prompt，体验自然语言控制。
4. 点击「打开 cloud_sheet.html」进入云端切片协同矩阵。
5. 在切片页标记曲线后导出 PPTX 报告。

首页内置的示例 Prompt：

- `cut the data above 150`
- `hide bad channels`
- `show ice membrane temperature`

未配置 DeepSeek API Key 时，上述三条示例 Prompt 会使用本地 demo 兜底逻辑；配置 Key 后仍会保留原有 DeepSeek NL2Action 路由。

## 本地运行

由于浏览器对本地文件请求有限制，建议使用本地静态服务器打开项目：

```bash
python3 -m http.server 8000
```

然后访问：

- 主控台：http://localhost:8000/
- 云端切片协同矩阵：http://localhost:8000/cloud_sheet.html

本地 Demo 数据同样可通过首页「立即体验 Demo」加载。

## 在线演示

这个项目是纯静态页面，可以直接部署到 GitHub Pages。

推荐流程：

1. 将仓库推送到 GitHub。
2. 打开仓库的 `Settings` -> `Pages`。
3. 在 `Build and deployment` 中选择 `GitHub Actions`。
4. 等待 `Deploy static site to GitHub Pages` 工作流完成。
5. 访问 GitHub Pages 给出的公开网址。

通常网址格式为：

```text
https://<你的GitHub用户名>.github.io/<仓库名>/
```

## API Key 说明

项目中的 DeepSeek API Key 由使用者在页面中输入，并保存在当前浏览器的 `localStorage` 中。仓库不会提交任何真实 API Key。

如果要做公开演示，请不要把个人 API Key 写入源码。公开网页中的前端请求会在浏览器里执行，适合个人演示和内部试用；如果后续需要生产级公开服务，建议增加后端代理来保护 API Key。

## 文件数据说明

项目支持在浏览器中手动上传 CSV/TSV 实验数据。`.gitignore` 默认排除了 `*.csv`、`*.tsv`、`*.xlsx`、`*.xls` 和生成的 `*.pptx`，避免误提交实验原始数据或报告文件。

例外：`refrigerator_demo.csv` 会被提交到仓库，用于公开演示页的一键体验。
