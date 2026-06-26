"use client";

import { useEffect, useState } from "react";

/**
 * 检测用户是否启用了「减少动态效果」系统偏好。
 * 启用时，所有 GSAP 动效降级为直接显示终态，Lenis 也不启用。
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  return reduced;
}
