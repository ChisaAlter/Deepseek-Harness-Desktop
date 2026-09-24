/** 空白草稿问候：按本地时段给一句开场，对应原型 abHome 的问候文案。 */
export function greetingForHour(hour) {
  const h = Number.isFinite(hour) ? ((hour % 24) + 24) % 24 : new Date().getHours();
  if (h >= 5 && h <= 10) return '早上好';
  if (h >= 11 && h <= 12) return '中午好';
  if (h >= 13 && h <= 17) return '下午好';
  return '晚上好';
}

export function blankGreeting(hour) {
  return `${greetingForHour(hour)}，今天做点什么`;
}
