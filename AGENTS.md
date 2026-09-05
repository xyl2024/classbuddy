# AGENTS.md

## 项目概述

本项目是一个面向个人教师备课和课堂讲解的英语试题讲解工具。
前端使用 React + Vite + TypeScript，后端使用 Node.js + Express，后端负责读取本地试卷目录、提供 HTTP 接口并保存材料批注。

## 常用命令

```bash
# 安装依赖
npm install

# 开发环境启动，默认读取 ./data，监听 3000 端口
npm run dev -- --data ./data --port 3000

# 生产构建
npm run build

# 生产环境启动
NODE_ENV=production npm run start -- --data ./data --port 3000
```

每次修改 TypeScript、React 或服务端代码后，至少执行 `npm run build` 验证类型检查和生产构建。

## 目录结构

```text
server.ts              # Express 服务、试卷读取/保存接口、文件变化事件
src/main.tsx           # React 入口，仅负责挂载 App
src/App.tsx            # 应用组装：目录加载、试题组选中、文件变化提示
src/types.ts           # 共享类型（考试集/试题/批注/工具）
src/api.ts             # 后端接口请求封装
src/hooks/             # 自定义 Hook（如 useAnnotations：批注状态与撤销/重做）
src/components/        # UI 组件（Sidebar、MaterialPane、QuestionsPane 等）
src/styles.css         # 全局样式
public/                # 可选的静态资源
 data/                 # 本地试卷样例或开发数据
CONTEXT.md             # 领域术语
```

## 数据目录约定

启动参数 `--data` 指向包含多个考试集的根目录：

```text
<data-dir>/
└── examination-name/
    ├── meta.json                 # 可选，考试集元数据
    └── item-1/
        ├── meta.json
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

- 界面采用左右布局，默认材料区与题目区为 2:1。
- 材料区和题目区独立滚动。
- 批注包括文本高亮、自由笔迹和直线。
- 批注保存到当前试题组的 `annotations.json`，每次操作后自动保存。
- 支持选择、高亮、画笔、直线和橡皮擦工具，以及撤销、重做和清空批注。
- 题目区域用于教师讲解，不是学生答题系统；不要引入答题提交、判分或用户系统概念。
- 答案默认隐藏，可逐题或全部预览；预览时显示正确答案和解析。
- 外部文件变化通过服务端事件通知，页面提示教师手动重新加载。
- 单个试题组文件异常不应导致整个服务启动失败，应在导航中标记异常。

## 修改规范

- 保持领域术语与 `CONTEXT.md` 一致：使用“考试集”“试题组”“材料”“题目”“批注”“答案预览”。
- 优先保持简单实现，不要在没有需求时引入复杂状态管理、数据库、认证或多用户逻辑。
- 修改文件读写接口时注意路径安全，不能允许通过请求路径访问数据目录之外的文件。
- 不要把 `node_modules/`、`dist/`、日志或本地环境配置提交到版本库。
- 样例试卷位于 `data/sample-examination/`，用于本地测试，除非用户明确要求，不要删除。
- 保持中文界面文案；英语材料和题目内容可以使用英文。

## 验证清单

提交改动前检查：

1. `npm run build` 是否通过。
2. 使用样例数据启动后，是否能读取 `data/sample-examination/`。
3. 两个试题组是否均显示，每组是否有 5 道题。
4. 批注操作后 `annotations.json` 是否能更新。
5. 是否误将构建产物、依赖或临时文件加入版本库。
