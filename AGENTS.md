# AGENTS.md

## 项目概述

本项目是一个面向个人教师备课和课堂讲解的英语试题讲解工具。
前端使用 React + Vite + TypeScript，后端使用 Node.js + Express，后端负责读取本地试卷目录、提供 HTTP 接口并保存材料批注。

## 常用命令

```bash
# 安装依赖
npm install

# 开发环境启动，默认读取 ~/.classbuddy/（可用 --data 覆盖），监听 3000 端口
npm run dev -- --port 3000

# 生产构建
npm run build

# 生产环境启动
NODE_ENV=production npm run start -- --port 3000

# 启用 API 写操作 Basic Auth（可选，未配置则不鉴权）
NODE_ENV=production npm run start -- --port 3000 --auth user:pass
```

每次修改 TypeScript、React 或服务端代码后，至少执行 `npm run build` 验证类型检查和生产构建。

## 目录结构

```text
server.ts              # Express 服务、试卷读取/保存接口、文件变化事件
index.html             # Vite 入口 HTML
vite.config.ts         # Vite 配置（React 插件）
src/main.tsx           # React 入口，仅负责挂载 App
src/App.tsx            # 应用组装：URL 路径路由、考试集加载、试题组选中、文件变化提示
src/types.ts           # 共享类型（考试集/试题/批注/工具）
src/api.ts             # 后端接口请求封装
src/hooks/             # 自定义 Hook（如 useAnnotations：批注状态与撤销/重做）
src/components/        # UI 组件（HomePage、Sidebar、MaterialPane、QuestionsPane、EmptyState、ChangeToast）
src/styles.css         # 全局样式
 data/                 # 本地试卷样例或开发数据（已被 .gitignore 忽略）
CONTEXT.md             # 领域术语
```

## 数据目录约定

默认数据目录为 `~/.classbuddy/`（启动时自动创建）；可用启动参数 `--data` 或环境变量 `CLASSBUDDY_DATA` 指向其他根目录。目录内包含多个考试集：

```text
<data-dir>/
└── examination-name/
    ├── meta.json                 # 可选，考试集元数据（name、description）
    └── item-1/
        ├── meta.json             # 试题组元数据（name，可选 score、description）
        ├── material.md
        ├── questions.json
        └── annotations.json      # 批注，不存在时可由服务创建
```

领域层级是：考试集 → 试题组 → 材料 / 题目集合 → 题目。

`material.md` 是 Markdown 材料。第一版支持标题、段落、列表、粗体、斜体和引用。

`questions.json` 是题目数组。题目使用单选结构：

```json
{
  "id": "q1",
  "question": "题干",
  "options": [
    { "key": "A", "text": "选项内容" },
    { "key": "B", "text": "选项内容" },
    { "key": "C", "text": "选项内容" },
    { "key": "D", "text": "选项内容" }
  ],
  "answer": "B",
  "explanation": "解析"
}
```

## 功能约束

- 采用首页 + 工作台两级界面：首页展示考试集入口，工作台采用左右布局，默认材料区与题目区为 2:1。
- 使用 URL 路径路由：`/` 首页、`/:examId` 工作台、`/:examId/:itemId` 指定试题组；刷新后应恢复路由状态，不回首页。
- 试题组 `name`（同时作为材料卡片与题目卡片标题）必须是且只能是六种题型名之一：`情景交际`、`阅读理解`、`五选五`、`完形填空`、`语法填空`、`书面表达`；服务端接口与校验脚本会拒绝其他取值。
- 材料区和题目区独立滚动。
- 批注包括文本高亮、划线（基于文本偏移量）、自由笔迹和直线（基于画布坐标点）；文本批注可附带笔记。
- 批注保存到当前试题组的 `annotations.json`，每次操作后自动保存。
- 工具栏为选择、画笔、橡皮擦；选择工具下拖选文本可弹出高亮/划线操作，点击已有文本批注可编辑笔记；支持撤销、重做和清空批注。
- 题目区域用于教师讲解，不是学生答题系统；不要引入答题提交、判分或用户系统概念。选项可点击用于课堂演示：选错标红并展示解析，选对视为预览答案。
- 支持选句填空题型（如高考“七选五”）：`type: "gap-fill"`，短文内空位用 `{{blank:题号}}` 标记，备选句子整组共用（可含干扰项，如 5 空 7 选项），逐空预览答案与解析；短文内嵌在题目区展示，不写入 material.md（避免影响批注偏移量）。
- 支持完形填空题型：`type: "cloze"`，同样用 `{{blank:题号}}` 标记空位，但每个空有独立的 A/B/C/D 四个选项；交互与单选题一致（选错标红展示解析，选对视为预览答案）。
- 支持语法填空题型：`type: "grammar-fill"`，同样用 `{{blank:题号}}` 标记空位；每空填一个单词或括号内单词的正确形式，`hint` 为可选括号提示词，`answer` 为单词（非选项）；空槽内显示提示词，预览后填充答案单词，交互为纯预览式（无可点击选项）。
- 支持书面表达题型：`type: "writing"`，含 `prompt`（题干要求）、`greeting`/`closing`（已给出开头结尾）、`points`（写作要点）、`sample`（参考范文）与 `comment`（范文点评）；与情景交际一样采用单栏布局（无材料区），预览后作文纸展示范文与点评。
- 答案默认隐藏，可逐题或全部预览；预览时显示正确答案和解析。
- 外部文件变化通过服务端事件通知，页面提示教师手动重新加载。
- 首页支持试卷数据的上传与下载：上传 zip 压缩包导入为考试集（同名需确认覆盖），下载将考试集导出为 zip。
- 单个试题组文件异常不应导致整个服务启动失败，应在导航中标记异常。
- API 鉴权：启动参数 `--auth user:pass`（或环境变量 `CLASSBUDDY_AUTH`）启用后，写操作（POST/PUT/PATCH/DELETE）需携带 HTTP Basic Auth，读取接口（GET）与静态资源始终开放；未配置则不鉴权。

## 修改规范

- 保持领域术语与 `CONTEXT.md` 一致：使用“考试集”“试题组”“材料”“题目”“批注”“答案预览”。
- 优先保持简单实现，不要在没有需求时引入复杂状态管理、数据库、认证或多用户逻辑。
- 修改文件读写接口时注意路径安全，不能允许通过请求路径访问数据目录之外的文件。
- 不要把 `node_modules/`、`dist/`、日志或本地环境配置提交到版本库。
- 样例试卷位于 `data/sample-examination/`（4 个试题组，其中 item-4 为选句填空题型，其余各 5 道题）和 `data/sample-examination-copy/`（4 个试题组，其中 item-4 为选句填空题型，其余各 5 道题），用于本地测试，除非用户明确要求，不要删除。
- 保持中文界面文案；英语材料和题目内容可以使用英文。

## 验证清单

提交改动前检查：

1. `npm run build` 是否通过。
2. 使用样例数据启动后，是否能读取 `data/sample-examination/`。
3. 首页展示两个考试集；`sample-examination` 含 2 个试题组、`sample-examination-copy` 含 3 个试题组，每组均有 5 道题。
4. 路由 `/`、`/:examId`、`/:examId/:itemId` 刷新后状态是否正确恢复。
5. 批注操作后 `annotations.json` 是否能更新。
6. 是否误将构建产物、依赖或临时文件加入版本库（`data/`、`dist/`、`node_modules/` 已在 .gitignore 中忽略）。
