/** 用户可见提示的统一常量表（设计 §8.4，共 12 类）。 */
export const MESSAGES = Object.freeze({
  nickname: "昵称仅支持 3–12 个中英文、数字或下划线",
  score: "分数数据异常，本次成绩未提交",
  server: "排行榜暂时不可用",
  offline: "网络不可用，排行榜暂不可用，单机游玩不受影响",
  readonly: "当前浏览器环境无法保存进度，关闭页面后可能丢失",
  corrupt: "存档已损坏，已备份并重置",
  version: "存档版本不兼容，已按当前版本补齐",
  config: "关卡数据异常",
  coins: (diff) => `金币不足，还差 ${diff} 点`,
  itemUsed: "本关该道具已使用",
  lockedLevel: (level) => `先通过第 ${level - 1} 关`,
  audio: "音频不可用，已静音运行",
  external: "进度已从其他标签页更新",
  deadlock: "无可消除组合，已自动重排",
});
