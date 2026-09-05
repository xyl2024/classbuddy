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

export interface Question {
  id?: string;
  question: string;
  options: QuestionOption[];
  answer: string;
  explanation?: string;
}

export interface ItemMeta {
  name?: string;
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
