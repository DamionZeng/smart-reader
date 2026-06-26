"use client";

import { useRef } from "react";
import { useGSAP } from "@gsap/react";
import { ensureGsapRegistered, gsap } from "@/lib/gsap/register";

interface StaggerFadeUpProps {
  children: React.ReactNode;
  className?: string;
  /** 直接子元素选择器，默认选取带 data-fade 的元素 */
  selector?: string;
  stagger?: number;
  y?: number;
  delay?: number;
  duration?: number;
}

/**
 * 通用滚动揭示：对 [data-fade] 子元素做错位淡入上滑。
 * 是 section 内容块的主力动效。
 */
export function StaggerFadeUp({
  children,
  className,
  selector = "[data-fade]",
  stagger = 0.12,
  y = 28,
  delay = 0,
  duration = 0.9,
}: StaggerFadeUpProps) {
  const ref = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      ensureGsapRegistered();
      const items = ref.current?.querySelectorAll<HTMLElement>(selector);
      if (!items || !items.length) return;

      gsap.set(items, { y, opacity: 0 });

      gsap.to(items, {
        y: 0,
        opacity: 1,
        duration,
        delay,
        stagger,
        ease: "power3.out",
        scrollTrigger: { trigger: ref.current, start: "top 82%", once: true },
      });
    },
    { scope: ref, dependencies: [selector, stagger, y, delay, duration] },
  );

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
