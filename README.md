# Trace Studio

单文件离线工具：图片转 SVG + 手绘过程动画生成器。

## 文件

- `svg-trace-studio.html` — 原始单文件版（约 950KB，VTracer WASM 已内嵌，无外部依赖）
- `index.html` — 拆分版入口
- `css/main.css` — 主样式
- `js/vtracer-wasm.js` — VTracer WASM 胶水 + 内嵌 wasm 二进制（约 900KB）
- `js/app.js` — 工具逻辑：参数绑定、描摹、动画编排、导出器

两个入口功能一致；后续开发基于拆分版。

## 功能

1. **图片 → SVG / 静态 HTML**：浏览器端用 VTracer WASM 做位图描摹，可调参数输出矢量结果
2. **手绘过程动画**：把描摹结果按笔画/图层编排成逐笔绘制动画，导出为独立 HTML

## 使用

浏览器直接打开 `svg-trace-studio.html` 即可，无需安装、无需联网。

## 来源

原文件：`D:\Desktop\svg-trace-studio.html`（2026-09-06 复制入本项目，原件保留）
