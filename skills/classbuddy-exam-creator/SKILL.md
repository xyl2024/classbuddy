---
name: classbuddy-exam-creator
description: 为 classbuddy（英语试题讲解工具）生成一套完整的考试集试卷。当用户要求"出一张卷子/出一套试卷/生成考试集/出题/制作英语试题"，或要求通过接口对已有试卷增删查改（创建/更新/删除考试集与试题组）时，必须使用本 skill。涵盖情景交际、阅读理解、五选五（选句填空）、完形填空、语法填空、书面表达六种题型的生成规范与校验。试卷文件一律用 scripts/build_exam.py 的子命令逐题型搭建（不要手写 JSON），并通过 scripts/classbuddy_api.py 把试卷推送到运行中的 classbuddy 服务。
---

# ClassBuddy 试卷生成

指引你为 classbuddy 生成一套结构正确、可直接被服务端加载讲解的完整考试集（Examination）。

**核心原则：不要手写 `questions.json` / `meta.json` 等 JSON 文件。**用 `scripts/build_exam.py` 的子命令逐题型搭建试卷：每种题型有专属命令（如 `add-blank-cloze` 加完形空位、`set-passage` 写短文），命令即时写盘、即时校验，避免字段名、JSON 转义、`{{blank:N}}` 对应等常见错误。命令用法见 `references/exam-commands.md`。

## 总体流程

1. **分步引导询问**：按"引导式询问（四步）"一节逐步问清：试卷名 → 主题/难度/范围/资料（引导用户提供资料路径供阅读）→ 是否用默认出题模板 → 应用地址。
2. **确认输出位置与考试集 id**：默认生成到 `data/<exam-id>/`（`data/` 已被 gitignore，适合本地测试）；如用户指定了目标目录，以用户为准。
3. **搭建议**：把一整套 `build_exam.py` 命令写成一个 bash 脚本一次性执行（出错即停）；短文、材料正文、范文等长文本先写入临时文件（如 `/tmp/article-a.md`）再用 `@路径` 传参，短文本直接内联。
4. **生成与校验**：按 `references/exam-commands.md` 的典型流程逐题组搭建（内容规范对照 `references/question-schemas.md`），完成后运行 `python3 <skill目录>/scripts/build_exam.py validate <考试集目录>`；有 errors 时用对应子命令修正（`remove-*` 删除后重加），直到 0 errors。
5. **推送到服务**：先跑 `health` 探针确认 classbuddy 服务可达（默认 `http://localhost:3000`，不可达则提示用户启动服务并停止，不要继续推送），然后用 `build_exam.py push <考试集目录>`（等价于 `classbuddy_api.py push-exam`，服务端同名时加 `--force`）整体上传，页面会实时感知。
6. **交付**：告诉用户考试集目录位置与推送结果，并提示可在首页查看。

在开始生成前，先阅读 `references/exam-commands.md` 与 `references/question-schemas.md`，不要凭记忆编写。

## 引导式询问（四步）

采用**分步引导**的方式逐项询问用户，一次只问一步，等用户回答后再进入下一步。用户在某一步已明确给出的信息（如在初始请求里就报了卷名）可以顺带确认后跳过该步，不要重复追问。

### 第 1 步：试卷名称

- 询问试卷的名称（中文名，如"高一英语期中模拟卷"）。
- 若名称不是纯 ASCII，据此生成 exam-id（ASCII，如 `midterm-exam`），生成后向用户确认一次。
- 确认输出位置：默认生成到 `data/<exam-id>/`（`data/` 已被 gitignore，适合本地测试）；如用户指定了目标目录，以用户为准。

### 第 2 步：主题、难度、范围与资料

询问出题的以下要素，并**重点引导用户提供资料路径**：

- **主题/话题**：如环保、校园生活、传统文化等。
- **难度/学段**：如中考、高一、高三一轮复习等；决定词汇与句式复杂度。
- **本次考试范围**：可指定的课文/单元/词汇范围、考察重点（如定语从句、时态、推断题、应用文）、文体偏好。
- **课本资料与复习材料**：主动引导用户"如果有课本、讲义、词汇表、往年真题等资料，可以把文件路径告诉我，我会先阅读再据此出题"。用户给出路径后，先用读文件工具阅读材料内容，再进入下一步。

### 第 3 步：出题模板

- 询问是否使用**默认出题模板**（7 个试题组的固定结构，见下节"标准试卷结构"：情景交际 5 题 + 阅读理解 A/B 篇各 5 题 + 五选五 5 空 + 完形填空 15 空 + 语法填空 10 空 + 书面表达 1 题，全卷满分 150 分）。
- 用户选择默认模板则直接按标准结构出卷；如用户要调整题量、题型或分值，按用户的组合来，但保持"题号全卷连续"和各题型的字段规范。

### 第 4 步：应用地址

- 询问 classbuddy 服务的应用地址（用于最后推送试卷），默认 `http://localhost:3000`。
- 该地址将用于 `build_exam.py push` / `classbuddy_api.py` 的 `--url` 参数（或 `CLASSBUDDY_URL` 环境变量）。

四步问齐后开始生成。

## 标准试卷结构

一套完整试卷按以下固定顺序生成 7 个试题组。全卷题号连续（这是真实试卷的编号惯例，五选五/完形/语法填空的空位标记 `{{blank:N}}` 中的 N 必须用这些全卷题号）：

| 试题组 | 题型 | `sectionType` | 题量 | 每小题分 | 满分 | 全卷题号 | 主要子命令 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `item-1` | 情景交际 | `situational-communication` | 5 题 | 3 分 | 15 分 | 1–5 | `add-dialogue` ×5（待填台词写 `{{blank}}`） |
| `item-2` | 阅读理解（A 篇） | `reading-comprehension` | 5 题 | 3 分 | 15 分 | 6–10 | `set-material` + `add-choice` ×5 |
| `item-3` | 阅读理解（B 篇） | `reading-comprehension` | 5 题 | 3 分 | 15 分 | 11–15 | 同上 |
| `item-4` | 五选五（选句填空） | `gap-fill` | 5 空 | 3 分 | 15 分 | 16–20 | `set-passage` → `gap-set-options`（默认模板下必须 5 个备选句）→ `add-blank-gap` ×5 |
| `item-5` | 完形填空 | `cloze` | 15 空 | 3 分 | 45 分 | 21–35 | `set-passage` → `add-blank-cloze` ×15（每空独立 4 选项） |
| `item-6` | 语法填空 | `grammar-fill` | 10 空 | 2 分 | 20 分 | 36–45 | `set-passage` → `add-blank-grammar` ×10 |
| `item-7` | 书面表达 | `writing` | 1 题 | — | 25 分 | 46 | `add-writing`（含范文与点评） |

全卷满分 150 分。以上分值已内建为 `build_exam.py` 的题型默认分值（`DEFAULT_SCORES`），省略 `--score-per-question` 时自动套用。用户指定了不同的题量/题型/分值组合时按用户的来，但保持“题号全卷连续”和各题型的字段规范。

### 试题组 name 约束（schema）

试题组 `meta.json` 的 `name` **必须是且只能是**：`情景交际`、`阅读理解`、`五选五`、`完形填空`、`语法填空`、`书面表达` 这六个词之一——它直接用作材料卡片和题目卡片的标题，**不能带篇目、副标题或任何附加文字**（如“阅读理解 A — The Quiet Strength of Lin Wei”不合法）。篇目区分（A/B 篇）写在材料正文首行标题或 `description` 里，不写进 name。`build_exam.py` 的 `add-item`/`update-item` 和校验脚本会强制执行此规则。

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

- 阅读理解各篇：**必须** `set-material` 写入完整文章正文（Markdown，可 `# A` / `# B` 开头）。文章是讲解时被批注的对象，不要把题目或答案混进去。篇目区分（A/B）写在材料正文首行标题里，不写进试题组 name。
- 五选五、完形、语法填空：短文用 `set-passage --passage` 写入（内嵌题目区展示），**绝不写进 material**（否则会错乱文本批注的偏移量）；material 由 `add-item` 自动写占位说明。
- 情景交际、书面表达：单栏题型（无材料区），material 用自动占位说明即可。

## 内容质量要求

- 题目材料与选项用英文，语言难度与用户指定的学段匹配；`explanation`、`instruction`、`name`、`description` 用中文。
- 解析要讲"为什么"：指出定位句或考点（如从句类型、固定搭配、时态依据），不要只重复答案。
- 阅读题的答案应能在原文找到依据；五选五在默认模板下 5 空 5 选项一一对应（非默认模板允许 5–7 选项，可含干扰项，干扰项要有真实的辨析度）；完形填空四个选项词性一致、语法上均可填入，靠上下文语义区分。
- `{{blank:N}}` 标记与 `--label` 必须一一对应，不允许多余或缺失。
- 不要引入学生答题、判分、用户系统等概念；本工具是教师讲解用途。

## 校验与修复

```bash
python3 <skill目录>/scripts/build_exam.py list <考试集目录>      # 概览：题型、题数、空位进度
python3 <skill目录>/scripts/build_exam.py validate <考试集目录>  # 结构校验，PASS (0 errors) 才可交付
```

`validate` 输出 errors 时用对应子命令修正：改字段用 `update-question`/`update-blank`、删题用 `remove-question`（可加 `--renumber` 重排剩余题 id）、删空位用 `remove-blank`（会同步移除 passage 中对应标记）、删试题组用 `remove-item`（有批注会拒绝），修正后重跑。warnings 逐条判断（如 writing 缺 sample/comment、题号不升序、阅读材料过短）。修复时优先对照 `references/exam-commands.md`（命令用法）与 `references/question-schemas.md`（内容规范），而不是猜测字段名。

**注意**：修改阅读理解 material 正文会使已有文本批注的偏移量错位。`patch-item --material` 时服务端会在批注非空且材料变化时返回警告（客户端会打印 `WARN`），确认后用 `--reset-annotations` 重置批注，或提示教师在页面上检查；`get-item --out` 会把 annotations.json 一并拉下，便于本地判断。

## 通过接口写入运行中的服务

服务端（`server.ts`）提供试卷增删查改 HTTP 接口（详见 `docs/api.md`）；所有接口调用都通过 Python 脚本完成，不要手写 curl 或直接改服务端数据目录。

- **连通性检查**：推送前先跑 `python3 <skill目录>/scripts/classbuddy_api.py health [--url URL]`，用 `/api/health` 探针确认服务可达；失败时提示用户先启动服务（`npm run dev`），不要盲目推送。

- **一键上传**：`python3 <skill目录>/scripts/build_exam.py push <考试集目录> [--url URL] [--force]`（先自动校验再整体上传）。
- 其余接口（查/改/删考试集与试题组）用 `scripts/classbuddy_api.py`，服务地址用 `--url` 或环境变量 `CLASSBUDDY_URL` 指定（默认 `http://localhost:3000`）。

```bash
API="python3 <skill目录>/scripts/classbuddy_api.py --url http://localhost:3000"

$API list-exams                       # 列出全部考试集
$API get-exam <examId> [--full]       # 查看考试集（--full 含全部试题组内容）
$API create-exam <examId> --name "中文名" [--force]
$API update-exam <examId> --name "新名"
$API delete-exam <examId> --yes
$API get-item <examId> <itemId> [--out <本地目录>]          # 拉取到本地四个文件（含 annotations.json）
$API put-item <examId> <itemId> --dir <本地试题组目录> [--reset-annotations]
$API patch-item <examId> <itemId> [--meta F] [--material F] [--questions F] [--reset-annotations]
$API delete-item <examId> <itemId> --yes
```

约定：

- **先读后写**：修改已有试卷前先用 `get-exam --full` / `get-item --out` 拉取现状，不要盲写。
- `put-item` 整体替换会重写三个文件但**保留已有批注**；材料文本变了批注偏移量会错位，服务端会返回警告，此时应加 `--reset-annotations`。
- 局部改动（如只换单题答案/解析）优先用 `build_exam.py update-question`/`update-blank`；跨文件局部改动用 `patch-item`，避免覆盖其他文件。
- 五选五/完形/语法填空的短文在 questions.json 首题的 passage 字段，不在 material.md；两者分工见 `get-item --out` 的输出提示。
- 删除操作不可恢复，务必与用户确认后再执行。
