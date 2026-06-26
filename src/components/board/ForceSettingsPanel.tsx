"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Settings2, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { type ForceParams, DEFAULT_FORCE_PARAMS } from "@/utils/auto-layout";

interface ForceSettingsPanelProps {
  /** Current params — controlled by the parent (board page state). */
  params: ForceParams;
  /** Update handler — parent stores the new params and re-runs layout. */
  onChange: (params: ForceParams) => void;
  /** Disable when there's nothing to lay out. */
  disabled?: boolean;
}

/**
 * Floating panel that exposes the d3-force parameters as sliders.
 * Lives next to LayoutMenu in the toolbar. The parent owns the state
 * and is responsible for re-running `clusterForceDirectedLayout`
 * whenever `params` changes (typically via a useEffect on params).
 *
 * Sliders are intentionally coarse-grained (5-step range) — this is a
 * user-facing knob, not a precision tool.
 */
export function ForceSettingsPanel({ params, onChange, disabled }: ForceSettingsPanelProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
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
        left: rect.right - 240, // 240px panel width, right-aligned to button
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
        !(target as HTMLElement).closest?.("[data-force-panel]")
      ) {
        setOpen(false);
      }
    };
    window.document.addEventListener("mousedown", handler);
    return () => window.document.removeEventListener("mousedown", handler);
  }, [open]);

  const update = (key: keyof ForceParams, value: number) => {
    onChange({ ...params, [key]: value });
  };

  const reset = () => onChange({ ...DEFAULT_FORCE_PARAMS });

  return (
    <div className="relative inline-block" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        className="inline-flex items-center gap-1.5 bg-[#F9F8F6] border border-[#1C1C1C]/20 text-[#1C1C1C] font-sans text-[10px] uppercase tracking-[0.2em] px-3 py-2 transition-colors duration-200 hover:border-[#1C1C1C] disabled:opacity-30 disabled:cursor-not-allowed focus:outline-none"
        title={t("board.forceSettings")}
      >
        <Settings2 className="w-3.5 h-3.5" />
        <span>{t("board.forceSettings")}</span>
      </button>
      {open &&
        pos &&
        typeof window !== "undefined" &&
        createPortal(
          <div
            data-force-panel
            role="dialog"
            style={{ position: "fixed", top: pos.top, left: pos.left, width: 240 }}
            className="bg-[#F9F8F6] border border-[#1C1C1C] z-50 animate-in fade-in duration-150 p-4"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="font-sans text-[10px] uppercase tracking-[0.2em] text-[#1C1C1C]/60">
                {t("board.forceSettings")}
              </div>
              <button
                type="button"
                onClick={reset}
                className="text-[#1C1C1C]/40 hover:text-[#1C1C1C] transition-colors"
                title={t("board.resetForceSettings")}
              >
                <RotateCcw className="w-3 h-3" />
              </button>
            </div>

            <ForceSlider
              label={t("board.forceCharge", "Repulsion")}
              hint={t("board.forceChargeHint", "More negative = more spread out")}
              value={params.charge}
              min={-400}
              max={-50}
              step={10}
              onChange={(v) => update("charge", v)}
            />
            <ForceSlider
              label={t("board.forceLink", "Link distance")}
              hint={t("board.forceLinkHint", "Smaller = tighter clusters")}
              value={params.linkDistance}
              min={60}
              max={300}
              step={10}
              onChange={(v) => update("linkDistance", v)}
            />
            <ForceSlider
              label={t("board.forceCollide", "Collision")}
              hint={t("board.forceCollideHint", "Node spacing padding")}
              value={params.collide}
              min={10}
              max={60}
              step={2}
              onChange={(v) => update("collide", v)}
            />
            <ForceSlider
              label={t("board.forceCenter", "Centering")}
              hint={t("board.forceCenterHint", "Pull toward canvas center")}
              value={params.centerStrength}
              min={0.01}
              max={0.3}
              step={0.01}
              onChange={(v) => update("centerStrength", v)}
            />
            <ForceSlider
              label={t("board.forceClusterPull", "Cluster pull")}
              hint={t("board.forceClusterPullHint", "Higher = tighter clusters")}
              value={params.clusterPull}
              min={0.05}
              max={0.6}
              step={0.05}
              onChange={(v) => update("clusterPull", v)}
            />
          </div>,
          window.document.body
        )}
    </div>
  );
}

interface ForceSliderProps {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}

function ForceSlider({ label, hint, value, min, max, step, onChange }: ForceSliderProps) {
  return (
    <div className="mb-3 last:mb-0">
      <div className="flex items-center justify-between mb-1">
        <span className="font-sans text-[10px] uppercase tracking-[0.15em] text-[#1C1C1C]/80">
          {label}
        </span>
        <span className="font-mono text-[10px] text-[#1C1C1C]/60 tabular-nums">
          {value.toFixed(2)}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1 bg-[#1C1C1C]/15 appearance-none cursor-pointer accent-[#1C1C1C]"
      />
      {hint && (
        <div className="font-sans text-[9px] text-[#1C1C1C]/40 mt-0.5">{hint}</div>
      )}
    </div>
  );
}
