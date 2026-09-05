/** 选项配色表：按选项 key 顺序取色，预览答案时空槽与对应句子同色配对 */
export const OPTION_COLORS = [
  { fg: '#1e6fd9', bg: '#e8f1fd' }, // A 蓝
  { fg: '#b25b00', bg: '#fdf1e0' }, // B 橙
  { fg: '#267b49', bg: '#eaf7ef' }, // C 绿
  { fg: '#7a3fd1', bg: '#f2ebfd' }, // D 紫
  { fg: '#0d8a8a', bg: '#e2f5f5' }, // E 青
  { fg: '#c2417c', bg: '#fdeaf3' }, // F 粉
  { fg: '#8a6d1d', bg: '#faf5df' }, // G 黄褐
];

/** 取选项 key 对应的颜色（A=0、B=1…，超出循环取色） */
export const optionColor = (key: string) => {
  const index = ((key.charCodeAt(0) - 65) % OPTION_COLORS.length + OPTION_COLORS.length) % OPTION_COLORS.length;
  return OPTION_COLORS[index];
};
