"use client";

import { useRef } from "react";
import { useGSAP } from "@gsap/react";
import { ensureGsapRegistered, gsap } from "@/lib/gsap/register";

interface MaskRevealProps {
  children: React.ReactNode;
  className?: string;
  /** 揭示方向 */
  direction?: "up" | "left";
  /** 整体起始延迟（秒） */
  delay?: number;
  /** 动画时长（秒） */
  duration?: number;
}

/**
 * 遮罩揭示：内容从 overflow:hidden 容器内滑入。
 * 编辑杂志风的经典「翻页」感。
 */
export function MaskReveal({
  children,
  className,
  direction = "up",
  delay = 0,
  duration = 1,
}: MaskRevealProps) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      ensureGsapRegistered();
      if (!inner.current) return;

      const fromVars: gsap.TweenVars =
        direction === "up"
          ? { yPercent: 115, opacity: 0 }
          : { xPercent: -115, opacity: 0 };

      gsap.set(inner.current, fromVars);

      gsap.to(inner.current, {
        yPercent: 0,
        xPercent: 0,
        opacity: 1,
        duration,
        delay,
        ease: "power4.out",
        scrollTrigger: { trigger: outer.current, start: "top 88%", once: true },
      });
    },
    { scope: outer, dependencies: [direction, delay, duration] },
  );

  return (
    <div
      ref={outer}
      className={className}
      style={{ overflow: "hidden" }}
    >
      <div ref={inner}>{children}</div>
    </div>
  );
}
