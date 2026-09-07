/** 批注类型：文本高亮 / 划线（基于文本偏移量），自由笔迹 / 直线（基于画布坐标点） */
export type AnnotationType = 'highlight' | 'underline' | 'freehand' | 'line';

/** 批注所属区域：材料区 / 题目区（缺省视为材料区，兼容旧数据） */
export type AnnotationTarget = 'material' | 'questions';

export interface Annotation {
  id: string;
  type: AnnotationType;
  /** 所属面板：文本批注偏移量相对对应面板的全文，笔迹坐标相对对应面板的画布 */
  target?: AnnotationTarget;
  /** 文本批注（highlight/underline）：在材料全文中的字符偏移区间 */
  start?: number;
  end?: number;
  text?: string;
  /** 笔迹批注（freehand/line）：画布坐标点序列 */
  points?: [number, number][];
  /** 文本批注附带的笔记（点击高亮/划线内容填写） */
  note?: string;
  /** 笔迹批注（freehand）的画笔颜色 */
  color?: string;
  /** 笔迹批注（freehand）的画笔粗细（lineWidth） */
  width?: number;
}

export interface Item {
  id: string;
  name: string;
  valid: boolean;
  files: Record<string, boolean>;
}

export interface Exam {
  id: string;
  name: string;
  items: Item[];
}

export interface QuestionOption {
  key: string;
  text: string;
}

export interface ChoiceQuestion {
  id?: string;
  type?: 'choice';
  question: string;
  options: QuestionOption[];
  answer: string;
  explanation?: string;
}

export interface DialogueLine {
  speaker: string;
  text: string;
}

export interface DialogueChoiceQuestion {
  id?: string;
  type: 'dialogue-choice';
  dialogue: DialogueLine[];
  options: QuestionOption[];
  answer: string;
  explanation?: string;
}

/** 七选五（选句填空）：整篇短文 + 共用备选句子 + 逐空答案 */
export interface GapFillBlank {
  /** 题号（与试卷编号一致，如 "16"） */
  label: string;
  /** 正确选项 key */
  answer: string;
  explanation?: string;
}

export interface GapFillQuestion {
  id?: string;
  type: 'gap-fill';
  /** 短文原文，空位用 {{blank:16}} 标记 */
  passage: string;
  /** 备选句子（可含干扰项） */
  options: QuestionOption[];
  blanks: GapFillBlank[];
}

/** 完形填空：整篇短文 + 逐空独立选项与答案 */
export interface ClozeBlank {
  /** 题号（与试卷编号一致，如 "21"） */
  label: string;
  /** 本空的四个备选项 */
  options: QuestionOption[];
  /** 正确选项 key */
  answer: string;
  explanation?: string;
}

export interface ClozeQuestion {
  id?: string;
  type: 'cloze';
  /** 短文原文，空位用 {{blank:21}} 标记 */
  passage: string;
  blanks: ClozeBlank[];
}

/** 语法填空：整篇短文 + 逐空填词（可带括号提示词） */
export interface GrammarFillBlank {
  /** 题号（与试卷编号一致，如 "36"） */
  label: string;
  /** 括号内提示词（如 collect），无提示词的纯填空省略 */
  hint?: string;
  /** 正确答案（单词或词形，如 collection / which / to get） */
  answer: string;
  explanation?: string;
}

export interface GrammarFillQuestion {
  id?: string;
  type: 'grammar-fill';
  /** 短文原文，空位用 {{blank:36}} 标记 */
  passage: string;
  blanks: GrammarFillBlank[];
}

/** 书面表达：写作题，题干要求 + 已给出开头结尾 + 可选要点与参考范文 */
export interface WritingQuestion {
  id?: string;
  type: 'writing';
  /** 题干与写作要求 */
  prompt: string;
  /** 已给出的开头（如 Dear Peter,） */
  greeting?: string;
  /** 已给出的结尾（如 Yours, Li Hua） */
  closing?: string;
  /** 写作要点 */
  points?: string[];
  /** 参考范文（可预览） */
  sample?: string;
  /** 范文点评 */
  comment?: string;
}

/** 兼容旧版普通选择题，支持情景交际对话补全题、七选五选句填空题、完形填空题、语法填空题与书面表达题 */
export type Question = ChoiceQuestion | DialogueChoiceQuestion | GapFillQuestion | ClozeQuestion | GrammarFillQuestion | WritingQuestion;

export interface ItemMeta {
  name?: string;
  sectionType?: 'situational-communication' | string;
  instruction?: string;
  scorePerQuestion?: number;
  totalScore?: number;
  description?: string;
}

export interface AnnotationsFile {
  version: number;
  annotations: Annotation[];
}

/** GET /api/items/:exam/:item 返回的试题组数据 */
export interface ItemData {
  meta: ItemMeta;
  material: string;
  questions: Question[];
  annotations: AnnotationsFile;
}

/** 批注工具（laser 为临时激光笔迹，不写入批注、不保存） */
export type Tool = 'select' | 'freehand' | 'eraser' | 'laser';

/** 当前选中的试题组（考试集 id + 试题组 id） */
export interface Selected {
  exam: string;
  item: string;
}
