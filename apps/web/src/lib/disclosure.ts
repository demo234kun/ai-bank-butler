/**
 * 演示标注开关。
 *
 * 同一套代码支持两种构建：
 * - 默认（含评委演示版）：如实标注合成数据与演示通道；
 * - `VITE_DEMO_LABELS=0`：纯产品版，去掉"演示 / 合成数据 / 模拟核心"这类标注。
 *
 * 只影响措辞，不改变任何行为：数据源、核验通道、验证码策略都由服务端配置决定，
 * 关闭标注不会让仿真数据变成真实数据，也不会放宽任何安全校验。
 */
export const DEMO_LABELS = import.meta.env.VITE_DEMO_LABELS !== '0';

/** 需要保留但换一种说法的文案：[带标注版本, 纯产品版本] */
export function label(on: string, off: string): string {
  return DEMO_LABELS ? on : off;
}

/** 仅在带标注版本出现的整段说明。 */
export function labelOnly(text: string): string {
  return DEMO_LABELS ? text : '';
}
