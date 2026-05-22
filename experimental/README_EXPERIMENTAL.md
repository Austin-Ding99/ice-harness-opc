# Ice-Harness OPC 实验开发版

`experimental/` 是后续 AI Agent 新功能的隔离工作区，允许不稳定实现和快速试验，不影响 `stable-local/` 的实验室稳定流程，也不影响 `public-demo/` 的公网演示。

## 适合放在这里的方向

- WebSocket 实时数据流
- MCP 工具/连接器实验
- 多 Agent 编排
- 自动预警与自动修复策略
- 新 UI、新图表交互、新报告形态

## 工作约定

- 可以快速原型，但不要依赖这里作为实验室稳定版本。
- 新能力稳定后，再人工评估是否迁移到 `stable-local/` 或 `public-demo/`。
- 如需引入依赖，优先在本目录内保留说明，避免污染纯静态演示工作流。
