/** 批注类型：文本高亮 / 划线（基于文本偏移量），自由笔迹 / 直线（基于画布坐标点） */
export type AnnotationType = 'highlight' | 'underline' | 'freehand' | 'line';

export interface Annotation {
  id: string;
  type: AnnotationType;
  /** 文本批注（highlight/underline）：在材料全文中的字符偏移区间 */
  start?: number;
  end?: number;
  text?: string;
  /** 笔迹批注（freehand/line）：画布坐标点序列 */
  points?: [number, number][];
  /** 文本批注附带的笔记（点击高亮/划线内容填写） */
  note?: string;
  color?: string;
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

/** 兼容旧版普通选择题，支持情景交际对话补全题、七选五选句填空题与完形填空题 */
export type Question = ChoiceQuestion | DialogueChoiceQuestion | GapFillQuestion | ClozeQuestion;

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

/** 批注工具 */
export type Tool = 'select' | 'freehand' | 'eraser';

/** 当前选中的试题组（考试集 id + 试题组 id） */
export interface Selected {
  exam: string;
  item: string;
}
