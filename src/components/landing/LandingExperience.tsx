"use client";

import { useEffect } from "react";
import Lenis from "lenis";
import { ensureGsapRegistered, gsap, ScrollTrigger } from "@/lib/gsap/register";
import { useReducedMotion } from "@/lib/gsap/useReducedMotion";

/**
 * 首页动效顶层包装：
 * - 初始化 Lenis 平滑滚动并同步到 GSAP ScrollTrigger
 * - prefers-reduced-motion 启用时降级为原生滚动
 */
export function LandingExperience({ children }: { children: React.ReactNode }) {
  const reduced = useReducedMotion();

  useEffect(() => {
    if (reduced) return;
    ensureGsapRegistered();

    const lenis = new Lenis({
      duration: 1.1,
      smoothWheel: true,
      lerp: 0.1,
      wheelMultiplier: 1,
      touchMultiplier: 1.5,
    });

    // Lenis 驱动 ScrollTrigger
    lenis.on("scroll", ScrollTrigger.update);

    const raf = (time: number) => {
      lenis.raf(time * 1000);
    };
    gsap.ticker.add(raf);
    gsap.ticker.lagSmoothing(0);

    // 首次刷新，确保 ScrollTrigger 位置正确
    const refreshTimer = window.setTimeout(() => ScrollTrigger.refresh(), 300);

    return () => {
      window.clearTimeout(refreshTimer);
      gsap.ticker.remove(raf);
      lenis.destroy();
    };
  }, [reduced]);

  return <>{children}</>;
}
