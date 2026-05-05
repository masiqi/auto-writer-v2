# Auto Writer V2 — 项目规范

## 项目概述
AI 驱动的作文写作助手，支持多智能体协作，面向高中作文。

## 技术栈
- 后端：Hono + Cloudflare Workers (TypeScript)
- 前端：React + Tailwind CSS
- 部署：Cloudflare Workers paid plan
- LLM 接口：OpenAI 兼容 API（base_url + api_key + model）

## 开发规则

### Git 工作流
- 所有改动必须先有对应的 GitHub Issue
- 禁止直接在 main 分支提交
- 分支命名：`feat/issue-{编号}-{简短描述}` 或 `fix/issue-{编号}-{简短描述}`
- Commit message 遵循 Conventional Commits：`feat:` / `fix:` / `refactor:` / `docs:` / `test:`
- 每个 commit 引用 Issue 编号：`feat: 初始化项目结构 (#2)`
- 通过 Pull Request 合并，PR 描述引用 Issue：`Resolves #2`

### 测试
- 后端代码必须先写测试（TDD）
- 使用 Vitest 测试框架
- 提交 PR 前必须跑通全部测试

### 代码规范
- TypeScript strict mode
- 代码注释使用英文
- Issue 和 PR 使用中文
- 代码格式化：Prettier

### LLM 配置
- 支持 OpenAI 兼容接口（base_url + api_key + model）
- 不绑定特定 LLM 服务商
