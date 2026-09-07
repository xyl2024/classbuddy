---
name: classbuddy-exam-creator
description: 为 classbuddy（英语试题讲解工具）生成一套完整的考试集试卷。当用户要求"出一张卷子/出一套试卷/生成考试集/出题/制作英语试题"，或要求通过接口对已有试卷增删查改（创建/更新/删除考试集与试题组）时，必须使用本 skill。涵盖情景交际、阅读理解、五选五（选句填空）、完形填空、语法填空、书面表达六种题型的生成规范与校验。试卷文件一律用 scripts/build_exam.py 的子命令逐题型搭建（不要手写 JSON），并通过 scripts/classbuddy_api.py 把试卷推送到运行中的 classbuddy 服务。
---

# ClassBuddy 试卷生成

指引你为 classbuddy 生成一套结构正确、可直接被服务端加载讲解的完整考试集（Examination）。

**核心原则：不要手写 `questions.json` / `meta.json` 等 JSON 文件。**用 `scripts/build_exam.py` 的子命令逐题型搭建试卷：每种题型有专属命令（如 `add-blank-cloze` 加完形空位、`set-passage` 写短文），命令即时写盘、即时校验，避免字段名、JSON 转义、`{{blank:N}}` 对应等常见错误。命令用法见 `references/exam-commands.md`。

## 总体流程

1. **先问，后写**：向用户询问出题资料（见下节）。除非用户在请求里已经把难度、考察重点、范围都写清楚了，否则生成前必须先问。
2. **确认输出位置与考试集 id**：默认生成到 `data/<exam-id>/`（`data/` 已被 gitignore，适合本地测试）；如用户指定了目标目录，以用户为准。
3. **搭建议**：把一整套 `build_exam.py` 命令写成一个 bash 脚本一次性执行（出错即停）；短文、材料正文、范文等长文本先写入临时文件（如 `/tmp/article-a.md`）再用 `@路径` 传参，短文本直接内联。
4. **生成与校验**：按 `references/exam-commands.md` 的典型流程逐题组搭建（内容规范对照 `references/question-schemas.md`），完成后运行 `python3 <skill目录>/scripts/build_exam.py validate <考试集目录>`；有 errors 时用对应子命令修正（`remove-*` 删除后重加），直到 0 errors。
5. **推送到服务**：若 classbuddy 服务正在运行（默认 `http://localhost:3000`），用 `build_exam.py push <考试集目录>`（等价于 `classbuddy_api.py push-exam`，服务端同名时加 `--force`）整体上传，页面会实时感知。
6. **交付**：告诉用户考试集目录位置与推送结果，并提示可在首页查看。

在开始生成前，先阅读 `references/exam-commands.md` 与 `references/question-schemas.md`，不要凭记忆编写。

## 第一步：询问用户

用一两条消息问齐以下信息（用户已明确给出的项不要重复问）：

- **难度/学段**：如中考、高一、高三一轮复习等；决定词汇与句式复杂度。
- **考察重点**：如定语从句、时态、推断题、应用文等；影响语法填空与解析的侧写。
- **出题范围**：话题（如环保、校园生活、传统文化）、可指定的课文/词汇范围、文体偏好。
- **输出位置与考试集 id/名称**：默认生成到 `data/<exam-id>/`；id 用 ASCII（如 `midterm-exam`），name 建议用中文（如"高一英语期中模拟卷"）。

## 标准试卷结构

一套完整试卷按以下固定顺序生成 7 个试题组。全卷题号连续（这是真实试卷的编号惯例，五选五/完形/语法填空的空位标记 `{{blank:N}}` 中的 N 必须用这些全卷题号）：

| 试题组 | 题型 | `sectionType` | 题量 | 全卷题号 | 主要子命令 |
| --- | --- | --- | --- | --- | --- |
| `item-1` | 情景交际 | `situational-communication` | 5 题 | 1–5 | `add-dialogue` ×5（待填台词写 `{{blank}}`） |
| `item-2` | 阅读理解 A | `reading-comprehension` | 5 题 | 6–10 | `set-material` + `add-choice` ×5 |
| `item-3` | 阅读理解 B | `reading-comprehension` | 5 题 | 11–15 | 同上 |
| `item-4` | 五选五（选句填空） | `gap-fill` | 5 空 | 16–20 | `set-passage` → `gap-set-options`（5–7 备选句）→ `add-blank-gap` ×5 |
| `item-5` | 完形填空 | `cloze` | 15 空 | 21–35 | `set-passage` → `add-blank-cloze` ×15（每空独立 4 选项） |
| `item-6` | 语法填空 | `grammar-fill` | 10 空 | 36–45 | `set-passage` → `add-blank-grammar` ×10 |
| `item-7` | 书面表达 | `writing` | 1 题 | 46 | `add-writing`（含范文与点评） |

用户指定了不同的题量/题型组合时按用户的来，但保持"题号全卷连续"和各题型的字段规范。

### 试题组目录（由命令自动维护，供了解）

服务端以 4 文件齐全作为试题组有效（`valid`）的判断依据。`add-item` 会创建：

```text
item-N/
├── meta.json         # name/sectionType/instruction/scorePerQuestion/totalScore/description
│                     #   省略的元数据按题型自动补全（见 exam-commands.md）
├── material.md       # 来自 set-material / add-item --material；非阅读题型自动写占位说明
├── questions.json    # 题目数组（由各 add-* 命令追加，id 自动 q1…qN）
└── annotations.json  # 空批注；后续命令不会碰它
```

### 材料的写法

- 阅读理解 A/B：**必须** `set-material` 写入完整文章正文（Markdown，可 `# A` / `# B` 开头）。文章是讲解时被批注的对象，不要把题目或答案混进去。
- 五选五、完形、语法填空：短文用 `set-passage --passage` 写入（内嵌题目区展示），**绝不写进 material**（否则会错乱文本批注的偏移量）；material 由 `add-item` 自动写占位说明。
- 情景交际、书面表达：单栏题型（无材料区），material 用自动占位说明即可。

## 内容质量要求

- 题目材料与选项用英文，语言难度与用户指定的学段匹配；`explanation`、`instruction`、`name`、`description` 用中文。
- 解析要讲"为什么"：指出定位句或考点（如从句类型、固定搭配、时态依据），不要只重复答案。
- 阅读题的答案应能在原文找到依据；五选五的干扰项要与正确项有真实的辨析度；完形填空四个选项词性一致、语法上均可填入，靠上下文语义区分。
- `{{blank:N}}` 标记与 `--label` 必须一一对应，不允许多余或缺失。
- 不要引入学生答题、判分、用户系统等概念；本工具是教师讲解用途。

## 校验与修复

```bash
python3 <skill目录>/scripts/build_exam.py list <考试集目录>      # 概览：题型、题数、空位进度
python3 <skill目录>/scripts/build_exam.py validate <考试集目录>  # 结构校验，PASS (0 errors) 才可交付
```

`validate` 输出 errors 时用对应子命令修正：删题用 `remove-question`、删空位用 `remove-blank`、删试题组用 `remove-item`（有批注会拒绝），修正后重加/重跑。warnings 逐条判断（如 writing 缺 sample/comment、题号不升序、阅读材料过短）。修复时优先对照 `references/exam-commands.md`（命令用法）与 `references/question-schemas.md`（内容规范），而不是猜测字段名。

**注意**：修改阅读理解 material 正文会使已有文本批注的偏移量失效，需提示教师批注会失效或重置批注（`put-item --reset-annotations`）。

## 通过接口写入运行中的服务

服务端（`server.ts`）提供试卷增删查改 HTTP 接口（详见 `docs/api.md`）；所有接口调用都通过 Python 脚本完成，不要手写 curl 或直接改服务端数据目录。

- **一键上传**：`python3 <skill目录>/scripts/build_exam.py push <考试集目录> [--url URL] [--force]`（先自动校验再整体上传）。
- 其余接口（查/改/删考试集与试题组）用 `scripts/classbuddy_api.py`，服务地址用 `--url` 或环境变量 `CLASSBUDDY_URL` 指定（默认 `http://localhost:3000`）。

```bash
API="python3 <skill目录>/scripts/classbuddy_api.py --url http://localhost:3000"

$API list-exams                       # 列出全部考试集
$API get-exam <examId> [--full]       # 查看考试集（--full 含全部试题组内容）
$API create-exam <examId> --name "中文名" [--force]
$API update-exam <examId> --name "新名"
$API delete-exam <examId> --yes
$API get-item <examId> <itemId> [--out <本地目录>]          # 拉取到本地三个文件
$API put-item <examId> <itemId> --dir <本地试题组目录> [--reset-annotations]
$API patch-item <examId> <itemId> [--meta F] [--material F] [--questions F]
$API delete-item <examId> <itemId> --yes
```

约定：

- **先读后写**：修改已有试卷前先用 `get-exam --full` / `get-item --out` 拉取现状，不要盲写。
- `put-item` 整体替换会重写三个文件但**保留已有批注**；材料文本变了批注偏移量会失效，此时应加 `--reset-annotations`。
- 局部改动（如只换解析）用 `patch-item`，避免覆盖其他文件。
- 删除操作不可恢复，务必与用户确认后再执行。
