"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslation } from "react-i18next";
import { UserMenu } from "./UserMenu";
import { cn } from "@/utils/cn";

const NAV_ITEMS = [
  { key: "nav.home", href: "/" },
  { key: "nav.projects", href: "/dashboard" },
  { key: "nav.graph", href: "/graph" },
] as const;

export function SiteHeader() {
  const { t } = useTranslation();
  const pathname = usePathname();

  return (
    <nav className="fixed top-0 w-full bg-[#F9F8F6]/90 backdrop-blur z-50 border-b border-[#1C1C1C]/10 px-6 py-5">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        {/* Logo + 标题 */}
        <Link href="/" className="group flex items-center gap-3">
          {/* Logo 图片 */}
          <img
            src="/logo.png"
            alt="Cosmos"
            className="w-9 h-9 object-contain transition-transform duration-300 group-hover:scale-105"
          />
          {/* 主标题 + 副标题 */}
          <div className="flex flex-col leading-none">
            <span className="font-serif text-xl tracking-tight font-bold text-[#1C1C1C]">
              Cosmos
            </span>
            <span className="font-sans text-[10px] uppercase tracking-[0.25em] text-[#1C1C1C]/40 mt-1">
              SmartReader
            </span>
          </div>
        </Link>

        {/* Nav links */}
        <div className="flex items-center gap-8">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "group relative font-sans text-[11px] uppercase tracking-[0.2em] font-semibold transition-all duration-200",
                  active
                    ? "text-[#1C1C1C]"
                    : "text-[#1C1C1C]/40 hover:text-[#1C1C1C] hover:italic",
                )}
              >
                {t(item.key)}
                {/* 激活态下划线 */}
                <span
                  className={cn(
                    "absolute -bottom-1 left-0 h-px bg-[#1C1C1C] transition-all duration-300",
                    active ? "w-full" : "w-0 group-hover:w-full",
                  )}
                />
              </Link>
            );
          })}
          <UserMenu />
        </div>
      </div>
    </nav>
  );
}
