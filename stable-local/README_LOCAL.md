# Ice-Harness OPC 本地稳定实验版

`stable-local/` 是实验室日常使用的稳定工作区，保留原始主控台 UI、CSV 导入流程、通道控制、坏点清洗、切片同步和报告生成逻辑。

## 本地运行

在 `stable-local/` 目录中启动静态服务器：

```bash
cd stable-local
python3 -m http.server 8000
```

然后访问：

- 主控台：http://localhost:8000/
- 云端切片协同矩阵：http://localhost:8000/cloud_sheet.html

## CSV 导入说明

- 点击页面右上方的文件按钮导入本地 CSV/TSV/TXT 数据。
- 数据表头需要包含 `绝对时间`、`相对时间`、`时间` 或 `Time` 等时间列。
- 温度通道会进入主曲线；功率列会进入下方功率曲线。
- CSV 数据只在浏览器本地解析，不会自动上传到公网。

## 实验用途说明

该版本用于实验室稳定数据分析流程，包括制冷实验数据查看、通道筛选、异常点剔除、切片同步和 PPTX 报告生成。

## 不用于公网演示

`stable-local/` 不包含 Demo onboarding，不会自动加载 `refrigerator_demo.csv`，也不承担 GitHub Pages 对外展示职责。
