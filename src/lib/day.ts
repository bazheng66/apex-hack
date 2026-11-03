export function todayKey(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now)
}

export function formatDay(day: string): string {
  const [year, month, date] = day.split("-")
  return `${year} 年 ${Number(month)} 月 ${Number(date)} 日`
}
