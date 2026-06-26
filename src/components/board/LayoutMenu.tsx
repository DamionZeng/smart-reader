"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, LayoutGrid } from "lucide-react";
import { useTranslation } from "react-i18next";
import { type LayoutTemplate } from "@/utils/auto-layout";

interface LayoutMenuProps {
  /** Disable the menu when there are no nodes to lay out. */
  disabled?: boolean;
  /** Active template — used to highlight the currently selected option. */
  activeTemplate?: LayoutTemplate | null;
  /** Run the dagre auto-layout (top-to-bottom). */
  onAutoLayout: () => void;
  /** Apply a named layout template. */
  onApplyTemplate: (template: LayoutTemplate) => void;
}

/**
 * Single dropdown that replaces the old row of:
 *   [ Auto layout ]   [ Layout ] [ tree ] [ hierarchical ] [ radial ] [ compact ]
 *
 * Renders the menu through a React Portal so it can never be clipped
 * by overflow:hidden on a parent (e.g. the ReactFlow Panel container
 * or the Sidebar header).
 */
export function LayoutMenu({
  disabled,
  activeTemplate,
  onAutoLayout,
  onApplyTemplate,
}: LayoutMenuProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const reposition = () => {
      const btn = buttonRef.current;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      setPos({
        top: rect.bottom + 4,
        left: rect.left,
        width: rect.width,
      });
    };
    reposition();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        rootRef.current &&
        !rootRef.current.contains(target) &&
        !(target as HTMLElement).closest?.("[data-layout-menu]")
      ) {
        setOpen(false);
      }
    };
    window.document.addEventListener("mousedown", handler);
    return () => window.document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.document.addEventListener("keydown", handler);
    return () => window.document.removeEventListener("keydown", handler);
  }, [open]);

  const templates: LayoutTemplate[] = [
    "tree",
    "hierarchical",
    "radial",
    "compact",
    "force",
  ];

  const pick = (action: () => void) => {
    setOpen(false);
    action();
  };

  return (
    <div className="relative inline-block" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        className="inline-flex items-center gap-1.5 bg-[#F9F8F6] border border-[#1C1C1C]/20 text-[#1C1C1C] font-sans text-[10px] uppercase tracking-[0.2em] px-3 py-2 transition-colors duration-200 hover:border-[#1C1C1C] disabled:opacity-30 disabled:cursor-not-allowed focus:outline-none"
        aria-haspopup="menu"
        aria-expanded={open}
        title={t("board.layoutTemplates")}
      >
        <LayoutGrid className="w-3.5 h-3.5" />
        <span>{t("board.layoutTemplates")}</span>
        <ChevronDown
          className={`w-3 h-3 transition-transform duration-200${open ? " rotate-180" : ""}`}
        />
      </button>
      {open &&
        pos &&
        typeof window !== "undefined" &&
        createPortal(
          <div
            data-layout-menu
            role="menu"
            style={{
              position: "fixed",
              top: pos.top,
              left: pos.left,
              minWidth: pos.width,
            }}
            className="border border-[#1C1C1C] bg-[#F9F8F6] z-50 animate-in fade-in duration-150"
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => pick(onAutoLayout)}
              className="w-full text-left px-3 py-2 text-[10px] uppercase tracking-[0.2em] font-sans text-[#1C1C1C] hover:bg-[#1C1C1C] hover:text-[#F9F8F6] transition-colors flex items-center gap-1.5 whitespace-nowrap"
            >
              <LayoutGrid className="w-3 h-3" aria-hidden />
              <span>{t("board.autoLayout")}</span>
            </button>
            <div className="h-px bg-[#1C1C1C]/10" />
            {templates.map((tpl) => {
              const isActive = activeTemplate === tpl;
              return (
                <button
                  key={tpl}
                  type="button"
                  role="menuitem"
                  onClick={() => pick(() => onApplyTemplate(tpl))}
                  className={`w-full text-left px-3 py-2 text-[10px] uppercase tracking-[0.2em] font-sans transition-colors flex items-center gap-1.5 whitespace-nowrap ${
                    isActive
                      ? "bg-[#1C1C1C] text-[#F9F8F6]"
                      : "text-[#1C1C1C] hover:bg-[#1C1C1C] hover:text-[#F9F8F6]"
                  }`}
                >
                  <span
                    className={`w-3 h-3 inline-block border ${
                      isActive
                        ? "border-[#F9F8F6] bg-[#F9F8F6]"
                        : "border-[#1C1C1C]/40"
                    }`}
                    aria-hidden
                  />
                  <span>{t(`board.layout${tpl.charAt(0).toUpperCase()}${tpl.slice(1)}`)}</span>
                </button>
              );
            })}
          </div>,
          window.document.body
        )}
    </div>
  );
}
