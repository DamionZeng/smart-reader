"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { LogOut, Settings, User as UserIcon } from "lucide-react";
import { useSession, signOut } from "@/lib/auth-client";
import { cn } from "@/utils/cn";

interface UserMenuProps {
  className?: string;
}

export function UserMenu({ className }: UserMenuProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuItemsRef = useRef<Array<HTMLElement | null>>([]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const focusMenuItem = (index: number) => {
    const items = menuItemsRef.current.filter(Boolean) as HTMLElement[];
    if (items.length === 0) return;
    const clamped = ((index % items.length) + items.length) % items.length;
    items[clamped].focus();
  };

  const handleMenuKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const activeIndex = menuItemsRef.current.findIndex(
        (el) => el === document.activeElement
      );
      focusMenuItem(activeIndex + 1);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      const activeIndex = menuItemsRef.current.findIndex(
        (el) => el === document.activeElement
      );
      focusMenuItem(activeIndex - 1);
      return;
    }
  };

  if (isPending) {
    return (
      <div
        className={cn(
          "w-8 h-8 border border-[#1C1C1C]/10 bg-[#1C1C1C]/5 animate-pulse",
          className
        )}
        aria-hidden
      />
    );
  }

  if (!session?.user) {
    return (
      <Link
        href="/login"
        className={cn(
          "font-sans text-[10px] uppercase tracking-[0.2em] font-semibold text-[#1C1C1C] hover:italic transition-all duration-200 focus:outline-none",
          className
        )}
      >
        {t("nav.login")}
      </Link>
    );
  }

  const name = session.user.name || session.user.email || "";
  const initial = name.trim().charAt(0).toUpperCase() || "U";
  const image = session.user.image;

  const handleSignOut = async () => {
    setOpen(false);
    await signOut();
    router.push("/");
    router.refresh();
  };

  return (
    <div ref={ref} className={cn("relative", className)}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setOpen(true);
            setTimeout(() => focusMenuItem(0), 0);
          }
        }}
        className="w-8 h-8 border border-[#1C1C1C]/20 hover:border-[#1C1C1C] transition-colors overflow-hidden flex items-center justify-center bg-[#1C1C1C]/5 focus:outline-none"
      >
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={image}
            alt={name}
            className="w-full h-full object-cover"
            referrerPolicy="no-referrer"
          />
        ) : (
          <span className="font-serif text-sm text-[#1C1C1C] leading-none">
            {initial}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          onKeyDown={handleMenuKeyDown}
          className="absolute right-0 top-full mt-3 w-56 bg-[#F9F8F6] border border-[#1C1C1C]/10 z-50 animate-in fade-in duration-150"
        >
          <div className="px-4 py-3 border-b border-[#1C1C1C]/10">
            <div className="font-sans text-[10px] uppercase tracking-[0.2em] text-[#1C1C1C]/40 mb-1">
              {t("user.signedInAs")}
            </div>
            <div className="font-serif text-sm text-[#1C1C1C] truncate">
              {name}
            </div>
            {session.user.email && name !== session.user.email && (
              <div className="font-sans text-xs text-[#1C1C1C]/60 truncate mt-0.5">
                {session.user.email}
              </div>
            )}
          </div>
          <Link
            ref={(el) => {
              menuItemsRef.current[0] = el;
            }}
            href="/dashboard"
            onClick={() => setOpen(false)}
            role="menuitem"
            tabIndex={-1}
            className="flex items-center gap-3 px-4 py-3 text-sm font-sans text-[#1C1C1C] hover:bg-[#1C1C1C]/5 transition-colors focus:outline-none focus:bg-[#1C1C1C]/5"
          >
            <UserIcon className="w-4 h-4 text-[#1C1C1C]/60" />
            {t("user.dashboard")}
          </Link>
          <Link
            ref={(el) => {
              menuItemsRef.current[1] = el;
            }}
            href="/settings"
            onClick={() => setOpen(false)}
            role="menuitem"
            tabIndex={-1}
            className="flex items-center gap-3 px-4 py-3 text-sm font-sans text-[#1C1C1C] hover:bg-[#1C1C1C]/5 transition-colors focus:outline-none focus:bg-[#1C1C1C]/5"
          >
            <Settings className="w-4 h-4 text-[#1C1C1C]/60" />
            {t("user.settings")}
          </Link>
          <button
            ref={(el) => {
              menuItemsRef.current[2] = el;
            }}
            type="button"
            onClick={handleSignOut}
            role="menuitem"
            tabIndex={-1}
            className="w-full flex items-center gap-3 px-4 py-3 text-sm font-sans text-[#1C1C1C] hover:bg-[#1C1C1C]/5 transition-colors border-t border-[#1C1C1C]/10 focus:outline-none focus:bg-[#1C1C1C]/5"
          >
            <LogOut className="w-4 h-4 text-[#1C1C1C]/60" />
            {t("user.signOut")}
          </button>
        </div>
      )}
    </div>
  );
}
