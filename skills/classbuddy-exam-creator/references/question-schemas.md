# 六种题型数据结构参考

所有题目存放于各试题组的 `questions.json`（JSON 数组）。字段定义与 `src/types.ts` 保持一致。六种题型：`choice`（阅读理解，type 可省略）、`dialogue-choice`（情景交际）、`gap-fill`（五选五/选句填空）、`cloze`（完形填空）、`grammar-fill`（语法填空）、`writing`（书面表达）。

通用规则：

- `options` 元素结构统一为 `{"key": "A", "text": "选项内容"}`；同一题内 `key` 不得重复。
- `explanation` 均为可选中文解析字符串；`id` 建议填写且组内唯一。
- 空位标记统一为 `{{blank:题号}}`（情景交际待填位置为 `{{blank}}`，无题号）。
- 带空位的短文（gap-fill/cloze/grammar-fill 的 `passage`）内嵌在题目区展示，不写入 material.md；段落分隔用 `\n`。

## 1. 情景交际 dialogue-choice

每题自带一段对话，待填应答用 `{{blank}}` 标记（通常在 "You" 的台词里）。五道题各自独立成段对话。

```json
{
  "id": "q1",
  "type": "dialogue-choice",
  "dialogue": [
    { "speaker": "Mike", "text": "Mike, thank you for driving me home." },
    { "speaker": "You", "text": "{{blank}} Have a nice day." }
  ],
  "options": [
    { "key": "A", "text": "That's right" },
    { "key": "B", "text": "I'm afraid not" },
    { "key": "C", "text": "You're welcome" },
    { "key": "D", "text": "That's a good idea" }
  ],
  "answer": "C",
  "explanation": "对方表示感谢时，应回答“You're welcome”。"
}
```

必填：`type`、`dialogue`（非空，至少一行含 `{{blank}}`，每行 `speaker`/`text` 非空）、`options`（4 项）、`answer`（必须是选项 key）。

## 2. 阅读理解 choice

`type` 可写 `"choice"` 或省略。文章在 material.md，题目只含题干与选项。

```json
{
  "id": "q6",
  "type": "choice",
  "question": "Why do some people think saying “yes” to everything is risky?",
  "options": [
    { "key": "A", "text": "They will lose chances." },
    { "key": "B", "text": "They are lazy with work." },
    { "key": "C", "text": "People may make more requests." },
    { "key": "D", "text": "Things might go wrong later." }
  ],
  "answer": "D",
  "explanation": "第一段指出：Things are good at first but might go wrong later，即……"
}
```

必填：`question`（非空）、`options`（4 项）、`answer`。同一篇阅读的 5 道题按题号顺序排列，题干类型建议覆盖细节题、推断题、主旨题、词义猜测题等。

## 3. 五选五 / 选句填空 gap-fill

整篇短文 + 整组共用备选句子（默认模板：5 空，5 个选项一一对应；非默认模板可 5–7 个选项，可含干扰项）。空位用全卷题号标记：

```json
{
  "id": "gf1",
  "type": "gap-fill",
  "passage": "Plant-based ice creams have become a good summer choice these days. {{blank:16}} If you doubt it, you may go to a local store and count all the ice creams that do not use cows’ milk. {{blank:17}} ……",
  "options": [
    { "key": "A", "text": "And there are several reasons for it." },
    { "key": "B", "text": "……" }
  ],
  "blanks": [
    { "label": "16", "answer": "B", "explanation": "……" }
  ]
}
```

必填：`type`、`passage`（含 5 个 `{{blank:16}}` … `{{blank:20}}` 标记，与 `blanks` 的 `label` 一一对应）、`options`（≥ 空数）、`blanks`（每项 `label`、`answer` 为选项 key）。

## 4. 完形填空 cloze

整篇短文 + 每空独立的 A/B/C/D 四个选项：

```json
{
  "id": "cloze1",
  "type": "cloze",
  "passage": "It was a sunny day. Kate was jumping rope in front of her house. She had all the time in the world to {{blank:21}} her jumping. ……",
  "blanks": [
    {
      "label": "21",
      "options": [
        { "key": "A", "text": "enjoy" },
        { "key": "B", "text": "practise" },
        { "key": "C", "text": "stop" },
        { "key": "D", "text": "record" }
      ],
      "answer": "A",
      "explanation": "……"
    }
  ]
}
```

必填：`type`、`passage`（15 个标记 `{{blank:21}}` … `{{blank:35}}`）、`blanks`（每项 `label`、`options` 4 项、`answer`）。四个选项要求词性一致且语法上都能填入空格。

## 5. 语法填空 grammar-fill

整篇短文 + 逐空填词。`hint` 为括号内提示词，纯填空（无提示词）省略该字段：

```json
{
  "id": "grammar1",
  "type": "grammar-fill",
  "passage": "Mr. Grey was a biology professor. He had a big {{blank:36}} of extremely rare (罕见的) bones, {{blank:37}} always made him proud. ……",
  "blanks": [
    { "label": "36", "hint": "collect", "answer": "collection", "explanation": "a big collection of… 为固定搭配……" },
    { "label": "37", "answer": "which", "explanation": "非限制性定语从句，缺少主语，故填 which。" }
  ]
}
```

必填：`type`、`passage`（10 个标记 `{{blank:36}}` … `{{blank:45}}`）、`blanks`（每项 `label`、`answer` 为单词或词形；`hint` 可选）。考点建议覆盖：冠词/介词（无提示词）、从句引导词、时态语态、词性转换、比较等级等，与用户指定的考察重点对齐。若原文出现生词，可在词后用括号加中文注释（如 `(罕见的)`）。

## 6. 书面表达 writing

```json
{
  "id": "writing1",
  "type": "writing",
  "prompt": "假定你是李华。你的外国朋友 Peter 计划寒假来中国旅游……\n内容包括：（1）表示欢迎；（2）介绍游玩安排……\n注意：1. 词数 90 左右；2. 开头和结尾已经给出，不计入词数……",
  "greeting": "Dear Peter,",
  "closing": "Yours,\nLi Hua",
  "points": ["表示欢迎", "介绍游玩安排：品尝美食、参观博物馆、参加朋友聚会等", "期待他的到来"],
  "sample": "I'm more than happy to hear that you're coming to China……",
  "comment": "范文点评文字"
}
```

必填：`type`、`prompt`（题干与要求）。可选：`greeting`（已给开头）、`closing`（已给结尾）、`points`（要点数组）、`sample`（参考范文，词数符合 prompt 要求）、`comment`（范文点评）。范文水平应贴近目标学段优秀作文，不要堆砌超纲词。
