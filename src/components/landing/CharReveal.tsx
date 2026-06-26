"use client";

import { useRef } from "react";
import { useGSAP } from "@gsap/react";
import { ensureGsapRegistered, gsap } from "@/lib/gsap/register";

interface CharRevealProps {
  text: string;
  className?: string;
  /** 每个字符的延迟（秒） */
  stagger?: number;
  /** 整体起始延迟（秒） */
  delay?: number;
  /** 单字符动画时长（秒） */
  duration?: number;
  /** 立即播放 还是 滚动进入视口时播放 */
  trigger?: "immediate" | "scroll";
}

/**
 * 逐字渐现：衬线大标题按字符上滑 + 淡入。
 * 不依赖 SplitText 付费插件，自行用 <span> 拆字。
 */
export function CharReveal({
  text,
  className,
  stagger = 0.035,
  delay = 0,
  duration = 0.9,
  trigger = "immediate",
}: CharRevealProps) {
  const ref = useRef<HTMLSpanElement>(null);

  useGSAP(
    () => {
      ensureGsapRegistered();
      const chars = ref.current?.querySelectorAll<HTMLElement>(".kg-char");
      if (!chars || !chars.length) return;

      // 立即设置初始隐藏态，避免 hydration 后一帧闪烁
      gsap.set(chars, { yPercent: 120, opacity: 0, rotateX: -60 });

      const tl = gsap.timeline({
        delay,
        scrollTrigger:
          trigger === "scroll"
            ? { trigger: ref.current, start: "top 85%", once: true }
            : undefined,
      });

      tl.to(chars, {
        yPercent: 0,
        opacity: 1,
        rotateX: 0,
        duration,
        stagger,
        ease: "power4.out",
      });
    },
    { scope: ref, dependencies: [text, trigger] },
  );

  return (
    <span ref={ref} className={className} style={{ perspective: 600, display: "inline-block" }}>
      {Array.from(text).map((ch, i) => (
        <span
          key={i}
          className="kg-char inline-block"
          style={{ transformOrigin: "bottom center", whiteSpace: "pre" }}
          aria-hidden
        >
          {ch}
        </span>
      ))}
      {/* 给屏幕阅读器的纯文本 */}
      <span className="sr-only">{text}</span>
    </span>
  );
}
