---
name: classbuddy-exam-creator
description: 为 classbuddy（英语试题讲解工具）生成一套完整的考试集试卷。当用户要求"出一张卷子/出一套试卷/生成考试集/出题/制作英语试题"，或要求通过接口对已有试卷增删查改（创建/更新/删除考试集与试题组）时，必须使用本 skill。涵盖情景交际、阅读理解、五选五（选句填空）、完形填空、语法填空、书面表达六种题型的生成规范与校验，并通过 scripts/classbuddy_api.py 把试卷推送到运行中的 classbuddy 服务。
---

# ClassBuddy 试卷生成

指引你为 classbuddy 生成一套结构正确、可直接被服务端加载讲解的完整考试集（Examination）。

## 总体流程

1. **先问，后写**：向用户询问出题资料（见下节）。除非用户在请求里已经把难度、考察重点、范围都写清楚了，否则生成前必须先问。
2. **确认输出位置**：本地先写到临时目录（如 `data/<exam-name>/`，`data/` 已被 gitignore，适合本地测试）；如用户指定了目标目录，以用户为准。
3. **按固定顺序生成 7 个试题组**（结构见下文"标准试卷结构"）。
4. **校验**：运行 `python3 <skill目录>/scripts/validate_exam.py <考试集目录>`，根据输出修复问题，直到 0 errors。warnings 逐条判断是否需要处理。
5. **推送到服务**：若 classbuddy 服务正在运行（默认 `http://localhost:3000`），用 `python3 <skill目录>/scripts/classbuddy_api.py push-exam <考试集目录>` 通过 HTTP 接口整体上传，页面会实时感知（见下文"通过接口写入运行中的服务"）。
6. **交付**：告诉用户考试集目录位置与推送结果，并提示可在首页查看。

在开始生成前，先阅读 `references/question-schemas.md`，其中是六种题型的完整字段定义与示例——所有字段名、空位标记格式都以它为准，不要凭记忆编写。

## 第一步：询问用户

用一两条消息问齐以下信息（用户已明确给出的项不要重复问）：

- **难度/学段**：如中考、高一、高三一轮复习等；决定词汇与句式复杂度。
- **考察重点**：如定语从句、时态、推断题、应用文等；影响语法填空与解析的侧写。
- **出题范围**：话题（如环保、校园生活、传统文化）、可指定的课文/词汇范围、文体偏好。
- **输出位置与考试集名称**：默认 `data/<exam-name>/`，name 建议用中文（如"高一英语期中模拟卷"）。

## 标准试卷结构

一套完整试卷按以下固定顺序生成 7 个试题组。全卷题号连续（这是真实试卷的编号惯例，五选五/完形/语法填空的空位标记 `{{blank:N}}` 中的 N 必须用这些全卷题号）：

| 试题组目录 | 题型 | `sectionType` | 题量 | 全卷题号 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `item-1` | 情景交际 | `situational-communication` | 5 题 | 1–5 | 每题一段对话，`{{blank}}` 待填 |
| `item-2` | 阅读理解 A | `reading-comprehension` | 5 题 | 6–10 | 文章写入 material.md |
| `item-3` | 阅读理解 B | `reading-comprehension` | 5 题 | 11–15 | 文章写入 material.md |
| `item-4` | 五选五（选句填空） | `gap-fill` | 5 空 | 16–20 | 备选句子 5–7 个（可含干扰项） |
| `item-5` | 完形填空 | `cloze` | 15 空 | 21–35 | 每空独立 A/B/C/D |
| `item-6` | 语法填空 | `grammar-fill` | 10 空 | 36–45 | 填单词或括号词的正确形式 |
| `item-7` | 书面表达 | `writing` | 1 题 | 46 | 应用文，含范文与点评 |

用户指定了不同的题量/题型组合时按用户的来，但保持"题号全卷连续"和各题型的字段规范。

### 每个试题组目录必须包含 4 个文件

服务端以 4 文件齐全作为试题组有效（`valid`）的判断依据，缺任何一个都会在导航中被标记为异常：

```text
item-N/
├── meta.json         # 试题组元数据
├── material.md       # 材料（非阅读题型可写一句占位说明）
├── questions.json    # 题目数组
└── annotations.json  # 固定内容 {"version": 1, "annotations": []}
```

`meta.json` 模板（`name`、`instruction`、`description` 用中文；`sectionType`、`scorePerQuestion`、`totalScore` 按上表填）：

```json
{
  "name": "阅读理解 A — 自拟标题",
  "sectionType": "reading-comprehension",
  "instruction": "阅读下列短文，掌握其大意，然后从每题所给的 A、B、C 和 D 项中选出最佳选项。",
  "scorePerQuestion": 3,
  "totalScore": 15,
  "description": "共5小题"
}
```

考试集根目录的 `meta.json`：`{"name": "考试集中文名", "description": "一句话说明"}`。

### material.md 的写法

- 阅读理解 A/B：文章正文，以 `# A` / `# B` 或标题开头。**注意**：文章是讲解时被批注的对象，必须写成连贯的 Markdown 正文，不要把题目或答案混进去。
- 五选五、完形、语法填空：短文内嵌在 `questions.json` 的 `passage` 字段，**绝不写入 material.md**（否则会错乱文本批注的偏移量）。material.md 只写一句占位说明，如 `# 标题\n\n本篇为选句填空题型，短文与备选句子见题目区。`
- 情景交际、书面表达：单栏题型（无材料区），material.md 写一句占位说明即可，可以留空内容，但文件必须存在。

## 内容质量要求

- 题目材料与选项用英文，语言难度与用户指定的学段匹配；`explanation`、`instruction`、`name`、`description` 用中文。
- 解析要讲"为什么"：指出定位句或考点（如从句类型、固定搭配、时态依据），不要只重复答案。
- 阅读题的答案应能在原文找到依据；五选五的干扰项要与正确项有真实的辨析度；完形填空四个选项词性一致、语法上均可填入，靠上下文语义区分。
- `{{blank:N}}` 标记与 `blanks` 数组的 `label` 必须一一对应，不允许多余或缺失。
- 不要引入学生答题、判分、用户系统等概念；本工具是教师讲解用途。

## 校验与修复

```bash
python3 <skill目录>/scripts/validate_exam.py <考试集目录>
```

输出 `PASS` 即可交付；有 errors 时逐条修复后重跑。修复时优先对照 `references/question-schemas.md` 的字段定义，而不是猜测字段名。

## 通过接口写入运行中的服务

服务端（`server.ts`）提供试卷增删查改 HTTP 接口（详见 `docs/api.md`）；所有接口调用都通过 Python 脚本 `scripts/classbuddy_api.py` 完成，不要手写 curl 或直接改服务端数据目录。服务地址用 `--url` 或环境变量 `CLASSBUDDY_URL` 指定（默认 `http://localhost:3000`），脚本不可用时（未启动服务等）才回退为直接写文件。

```bash
API="python3 <skill目录>/scripts/classbuddy_api.py --url http://localhost:3000"

# 一键：校验本地考试集目录并整体上传（服务端同名时用 --force 覆盖）
$API push-exam <考试集目录> [--force]

# 考试集级
$API list-exams                       # 列出全部考试集
$API get-exam <examId> [--full]       # 查看考试集（--full 含全部试题组内容）
$API create-exam <examId> --name "中文名" [--force]
$API update-exam <examId> --name "新名"
$API delete-exam <examId> --yes

# 试题组级
$API get-item <examId> <itemId> --out <本地目录>          # 拉取到本地三个文件
$API put-item <examId> <itemId> --dir <本地试题组目录>    # 整体替换（保留批注）
$API patch-item <examId> <itemId> --questions questions.json   # 局部更新单个文件
$API delete-item <examId> <itemId> --yes
```

约定：

- **先读后写**：修改已有试卷前先用 `get-exam --full` / `get-item --out` 拉取现状，不要盲写。
- `put-item` 整体替换会重写三个文件但**保留已有批注**；材料文本变了批注偏移量会失效，此时应加 `--reset-annotations`。
- 局部改动（如只换解析）用 `patch-item`，避免覆盖其他文件。
- 删除操作不可恢复，务必与用户确认后再执行。
