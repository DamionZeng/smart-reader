"use client";

import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

let registered = false;

/**
 * 在客户端一次性注册 GSAP 插件。
 * 在 SSR 阶段会被守卫跳过，避免 window 未定义错误。
 */
export function ensureGsapRegistered() {
  if (registered) return;
  if (typeof window === "undefined") return;
  gsap.registerPlugin(ScrollTrigger);
  // ScrollTrigger 默认 markers 关闭，这里显式配置平滑 scroller 时再绑定
  ScrollTrigger.config({ ignoreMobileResize: true });
  registered = true;
}

export { gsap, ScrollTrigger };
