"use client";

import { useEffect, useState } from "react";
import i18n from "@/i18n";
import { detectBrowserLanguage } from "@/lib/i18n-config";

/**
 * 解决 SSR/CSR 语言不一致导致的水合错误。
 *
 * - i18n 在初始化时被锁定为 lng: "en"，因此 SSR 总是用 "en" 渲染。
 * - 客户端 i18n 模块是一个单例。如果用户先前在别的页面调用过
 *   `i18n.changeLanguage("zh")`，那么客户端的 i18n.language 在 hydrate
 *   时就已经是 "zh"，与 SSR 的 "en" 不匹配 → React 报 hydration mismatch。
 *
 * 修复策略：
 * 1. 客户端模块加载时（见 `src/i18n.ts` 末尾），i18n.language 被强制
 *    重置为 "en" 以匹配 SSR 首次输出。该 reset 在 React 树 mount 之
 *    前同步执行，所以 React 第一次 render 时拿到的就是英文。
 * 2. 这个组件在 useEffect 中读 localStorage / navigator，把语言切
 *    回用户偏好。这只会触发一次普通 React 更新，不会引起水合警告。
 *
 * 检测顺序（高 → 低优先级）：
 *   1. localStorage.i18nextLng — 用户显式改过，永远胜出
 *   2. window.navigator.language — 浏览器首选，已与 10 种支持语言匹配
 *   3. DEFAULT_LANGUAGE (en) — 兜底
 *
 * 副作用：首次页面加载完成后，UI 会从 "en" 闪一下到目标语言（如果
 * 浏览器语言不是 en）。这是 i18n 的固有 trade-off，无法在保持 SSR
 * 的同时完全消除。
 */
export function I18nHydrationGate({ children }: { children: React.ReactNode }) {
  // We bump this counter after the post-mount language switch so that
  // react-i18next subscribers re-render with the new language. The
  // counter itself is never read.
  const [, setTick] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // 1. localStorage: user has explicitly picked a language — respect
    //    it even if it is not in the 10-language set, so the user's
    //    choice is never silently overridden. (We only validate when
    //    reading from navigator — localStorage is trusted.)
    const stored = window.localStorage.getItem("i18nextLng");

    // 2. navigator.language: walk the supported list and snap to the
    //    primary subtag. detectBrowserLanguage handles "zh-CN" → "zh"
    //    and unknown languages → "en".
    const detected = stored
      ? stored
      : detectBrowserLanguage(window.navigator.language);

    if (detected && detected !== i18n.language) {
      i18n.changeLanguage(detected).then(() => setTick((n) => n + 1));
    }
  }, []);

  return <>{children}</>;
}
