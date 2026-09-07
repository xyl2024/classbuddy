# build_exam.py 子命令参考

试卷文件**不手写 JSON**：用本脚本的子命令逐步搭建考试集目录。每条命令即时写盘并做局部校验，最后用 `validate` 子命令整体校验（0 errors 才算通过）。六种题型各有专属命令；内容规范（题量、解析深度、考点覆盖）见 `question-schemas.md`。

## 长文本约定

所有文本参数（`--question`、`--passage`、`--material`、`--explanation`、`--prompt`、`--sample`、`--comment`、`--hint` 等）统一支持三种写法：

- 内联字符串：`--answer "C" --explanation "对方致谢时回答 You're welcome。"`
- `@路径`：读文件，如 `--passage @/tmp/passage.txt`（推荐用于短文、材料、范文）
- `-`：读 stdin，如 `printf '%s' "..." | build_exam.py set-passage ... --passage -`

**推荐**：短文、材料正文、范文等长文本先写入临时文件（`.md`/`.txt`）再用 `@` 传入，避免 shell 引号转义问题；短选项直接内联。选项统一用重复的 `--opt "A=选项内容"`；对话行用 `--line "说话人|台词"`。

## 典型流程（一套完整卷）

```bash
B="python3 <skill目录>/scripts/build_exam.py"

# 1. 考试集（目录名即服务端 id：字母/数字/连字符/下划线）
$B init data/midterm-exam --name "高一英语期中模拟卷" --description "一句话说明"

# 2. 情景交际（5 题）：每题一条 add-dialogue，待填台词写 {{blank}}
$B add-item data/midterm-exam --name "情景交际" --type situational-communication
$B add-dialogue data/midterm-exam --item 1 \
  --line "Mike|Thank you for driving me home." \
  --line "You|{{blank}} Have a nice day." \
  --opt "A=That's right" --opt "B=I'm afraid not" --opt "C=You're welcome" --opt "D=That's a good idea" \
  --answer C --explanation "对方致谢应回答 You're welcome。"

# 3. 阅读理解（2 篇 × 5 题）：先写材料，再加题
$B add-item data/midterm-exam --name "阅读理解" --type reading-comprehension   # 第二篇再建 item 时同样用 --name "阅读理解"
$B set-material data/midterm-exam --item 2 --material @/tmp/article-a.md
$B add-choice data/midterm-exam --item 2 --question "Why is …?" \
  --opt "A=…" --opt "B=…" --opt "C=…" --opt "D=…" --answer B --explanation "定位句…。"

# 4. 五选五（5 空 5 备选句；非默认模板可 5–7 个）：短文 → 共用备选句 → 逐空
$B add-item data/midterm-exam --name "五选五" --type gap-fill
$B set-passage data/midterm-exam --item 4 --type gap-fill --passage @/tmp/passage.txt
$B gap-set-options data/midterm-exam --item 4 --opt "A=…" --opt "B=…" --opt "C=…" --opt "D=…" --opt "E=…"
$B add-blank-gap data/midterm-exam --item 4 --label 16 --answer B --explanation "承上启下。"

# 5. 完形填空（15 空）：短文 → 逐空（每空独立 4 选项）
$B add-item data/midterm-exam --name "完形填空" --type cloze
$B set-passage data/midterm-exam --item 5 --type cloze --passage @/tmp/passage.txt
$B add-blank-cloze data/midterm-exam --item 5 --label 21 \
  --opt "A=enjoy" --opt "B=practise" --opt "C=stop" --opt "D=record" --answer A --explanation "语境表示享受。"

# 6. 语法填空（10 空）：短文 → 逐空（无提示词的空省略 --hint）
$B add-item data/midterm-exam --name "语法填空" --type grammar-fill
$B set-passage data/midterm-exam --item 6 --type grammar-fill --passage @/tmp/passage.txt
$B add-blank-grammar data/midterm-exam --item 6 --label 36 --answer collection --hint collect --explanation "固定搭配。"

# 7. 书面表达（1 题）
$B add-item data/midterm-exam --name "书面表达" --type writing
$B add-writing data/midterm-exam --item 7 --prompt @/tmp/prompt.md \
  --greeting "Dear Peter," --closing "Yours, Li Hua" \
  --point "表示欢迎" --point "介绍安排" \
  --sample @/tmp/sample.md --comment "范文点评文字。"

# 8. 校验 → 推送
$B validate data/midterm-exam          # PASS (0 errors) 才继续
$B push data/midterm-exam [--url http://localhost:3000] [--force]
```

## 命令速查

| 命令 | 用途 |
| --- | --- |
| `init <examDir> --name N [--description D] [--force]` | 创建考试集目录与 meta.json |
| `list <examDir>` | 概览各试题组（题型、题数、空位进度） |
| `validate <examDir>` | 结构校验（内部调 validate_exam.py） |
| `push <examDir> [--url U] [--id ID] [--force]` | 校验后整体上传（等价于 classbuddy_api.py push-exam） |
| `add-item <examDir> --name N [--type T] [--instruction I] [--description D] [--score-per-question X] [--total-score Y] [--material T]` | 新建 item-N（4 文件齐全；material 缺省写占位说明；--name 必须是六大题型名之一） |
| `set-material <examDir> --item N --material T` | 写材料正文（阅读理解必做） |
| `update-item <examDir> --item N [--name/--type/--instruction/--description/--score-per-question/--total-score]` | 改元数据（--name 同样必须是六大题型名之一） |
| `add-choice` | 阅读理解单选：`--question Q --opt K=T×4 --answer K [--explanation E]` |
| `add-dialogue` | 情景交际：`--line "说话人\|台词"×n --opt K=T×4 --answer K` |
| `add-writing` | 书面表达：`--prompt P [--greeting G] [--closing C] [--point P]×n [--sample S] [--comment C]` |
| `update-question --id qID [--question Q] [--opt K=T...] [--answer K] [--explanation E \| --no-explanation]` | 改一道题的字段（写作另支持 `--prompt/--greeting/--closing/--point/--sample/--comment/--no-*`） |
| `update-blank --label N [--answer A] [--opt K=T...]（仅完形） [--explanation E \| --no-explanation] [--hint H \| --no-hint]` | 改一个空位的字段 |
| `set-passage --type gap-fill\|cloze\|grammar-fill --passage T [--replace]` | 写短文（每试题组仅一道短文题）；`--replace` 重写时保留新短文中仍出现的空位，其余删除并提示需补的空 |
| `gap-set-options` | 五选五共用备选句（`--opt` 5–7 个，可含干扰项；默认模板下必须 5 个） |
| `add-blank-gap --label N --answer K [--explanation E]` | 五选五加空（全卷题号已被其他试题组占用时报错） |
| `add-blank-cloze --label N --opt K=T×4 --answer K [--explanation E]` | 完形加空（同上） |
| `add-blank-grammar --label N --answer 单词 [--hint H] [--explanation E]` | 语法填空加空（同上） |
| `remove-item [--yes]` / `remove-question --id qID [--renumber]` / `remove-blank --label N` | 删除试题组 / 题 / 空位；`--renumber` 把剩余题 id 重排为 q1..qn；`remove-blank` 同步移除 passage 中对应 `{{{{blank:N}}}}` 标记 |

## 规则与注意事项

- **顺序**：先 `init`，再按 7 题组顺序 `add-item`；短文题型必须先 `set-passage` 再逐空加。
- **`{{blank:N}}`**：N 用全卷连续题号，必须与 `--label` 一一对应；`add-blank-*` 会校验标记存在、不重复，并按短文中出现顺序排列空位。
- **自动补全**：省略的 `sectionType`/`instruction`/`description`/分值按题型自动补（默认每小题分值见 `DEFAULT_SCORES`：情景交际/阅读/五选五/完形 3 分、语法填空 2 分、书面表达整题 25 分）；首个题目/短文加入时定型。需要自定义分值用 `add-item --score-per-question/--total-score` 或 `update-item`。
- **答错即拒**：`--answer` 不在选项 key、label 不在短文标记、台词缺 `{{blank}}`、重写短文未加 `--replace` 等，命令会报错退出且不破坏已有数据。
- **全卷题号唯一**：`add-blank-*` 会拒绝被其他试题组占用的题号；`validate` 也做全卷唯一性校验（重复报 error）。
- **批注安全**：`remove-item` 遇到已有批注会拒绝（加 `--yes` 覆盖）；其余命令不动 `annotations.json`。
- **材料偏移**：修改阅读理解 material 正文会使已有文本批注错位。`patch-item --material` 时服务端检测到批注非空会返回警告（客户端脚本打印 `WARN`）；确认错位后用 `--reset-annotations` 重置批注，或提示教师在页面上检查。`get-item --out` 会把 annotations.json 一并拉下，便于本地判断。
- **改题优先用 update-*：改某题 answer/explanation 等单字段用 `update-question`/`update-blank`，不要整文件拉回-改-推回；换题时先 `remove-question --renumber` 再 `add-*`，避免 id 冲突。
