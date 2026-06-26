"use client";

import { useEffect, useRef, useState } from "react";
import { Layout, Circle, Eye, Download, ChevronDown } from "lucide-react";
import { cn } from "@/utils/cn";

interface GraphToolbarProps {
  layout: string;
  onLayoutChange: (v: string) => void;
  sizeMetric: string;
  onSizeMetricChange: (v: string) => void;
  showHulls: boolean;
  onShowHullsChange: (v: boolean) => void;
  showEdges: boolean;
  onShowEdgesChange: (v: boolean) => void;
  showLabels: boolean;
  onShowLabelsChange: (v: boolean) => void;
  onExport: (format: string) => void;
}

const LAYOUT_OPTIONS = [
  { value: "force", label: "Force" },
  { value: "radial", label: "Radial" },
  { value: "hierarchical", label: "Hierarchical" },
];

const SIZE_METRIC_OPTIONS = [
  { value: "importance", label: "Importance" },
  { value: "frequency", label: "Frequency" },
  { value: "pagerank", label: "PageRank" },
];

const EXPORT_OPTIONS = [
  { value: "png", label: "PNG" },
  { value: "svg", label: "SVG" },
  { value: "graphml", label: "GraphML" },
  { value: "json", label: "JSON" },
];

/**
 * Editorial-style toggle switch — square, no rounded corners, no shadows.
 */
function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex items-center gap-2 group focus:outline-none"
    >
      <span
        className={cn(
          "inline-flex w-8 h-4 border transition-colors duration-200 relative",
          checked
            ? "bg-[#1C1C1C] border-[#1C1C1C]"
            : "bg-transparent border-[#1C1C1C]/30"
        )}
      >
        <span
          className={cn(
            "absolute top-0 w-4 h-4 transition-all duration-200",
            checked
              ? "left-4 bg-[#F9F8F6]"
              : "left-0 bg-[#1C1C1C]"
          )}
        />
      </span>
      <span className="font-sans text-[10px] uppercase tracking-[0.2em] text-[#1C1C1C]/60 group-hover:text-[#1C1C1C] transition-colors">
        {label}
      </span>
    </button>
  );
}

/**
 * Editorial-style dropdown — no rounded corners, thin border.
 */
function Dropdown({
  icon: Icon,
  value,
  options,
  onChange,
  ariaLabel,
}: {
  icon: React.ComponentType<{ className?: string }>;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const escHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", escHandler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", escHandler);
    };
  }, [open]);

  const currentLabel = options.find((o) => o.value === value)?.label ?? value;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex items-center gap-1.5 px-2.5 py-1.5 border border-[#1C1C1C]/30 hover:border-[#1C1C1C] transition-colors duration-200 focus:outline-none"
      >
        <Icon className="w-3 h-3 text-[#1C1C1C]/60" />
        <span className="font-sans text-[10px] uppercase tracking-[0.15em] text-[#1C1C1C]">
          {currentLabel}
        </span>
        <ChevronDown
          className={cn(
            "w-3 h-3 text-[#1C1C1C]/40 transition-transform duration-200",
            open && "rotate-180"
          )}
        />
      </button>
      {open && (
        <div
          role="listbox"
          className="absolute top-full left-0 mt-0.5 border border-[#1C1C1C] bg-[#F9F8F6] z-50 min-w-full animate-in fade-in duration-150"
        >
          {options.map((opt) => (
            <button
              key={opt.value}
              role="option"
              aria-selected={opt.value === value}
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
              className={cn(
                "w-full text-left px-2.5 py-1.5 font-sans text-[10px] uppercase tracking-[0.15em] transition-colors duration-200 border-b border-[#1C1C1C]/10 last:border-b-0",
                opt.value === value
                  ? "bg-[#1C1C1C] text-[#F9F8F6]"
                  : "text-[#1C1C1C] hover:bg-[#1C1C1C]/5"
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function GraphToolbar({
  layout,
  onLayoutChange,
  sizeMetric,
  onSizeMetricChange,
  showHulls,
  onShowHullsChange,
  showEdges,
  onShowEdgesChange,
  showLabels,
  onShowLabelsChange,
  onExport,
}: GraphToolbarProps) {
  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!exportOpen) return;
    const handler = (e: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) {
        setExportOpen(false);
      }
    };
    const escHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExportOpen(false);
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", escHandler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", escHandler);
    };
  }, [exportOpen]);

  return (
    <div className="absolute top-4 left-4 z-20 flex items-center gap-2 bg-[#F9F8F6] border border-[#1C1C1C] p-2">
      <Dropdown
        icon={Layout}
        value={layout}
        options={LAYOUT_OPTIONS}
        onChange={onLayoutChange}
        ariaLabel="Layout"
      />
      <div className="w-px h-6 bg-[#1C1C1C]/10" />
      <Dropdown
        icon={Circle}
        value={sizeMetric}
        options={SIZE_METRIC_OPTIONS}
        onChange={onSizeMetricChange}
        ariaLabel="Size metric"
      />
      <div className="w-px h-6 bg-[#1C1C1C]/10" />
      <div className="flex items-center gap-3 px-1">
        <Toggle checked={showHulls} onChange={onShowHullsChange} label="Hulls" />
        <Toggle checked={showEdges} onChange={onShowEdgesChange} label="Edges" />
        <Toggle checked={showLabels} onChange={onShowLabelsChange} label="Labels" />
      </div>
      <div className="w-px h-6 bg-[#1C1C1C]/10" />
      <div className="relative" ref={exportRef}>
        <button
          type="button"
          onClick={() => setExportOpen((v) => !v)}
          aria-label="Export graph"
          aria-haspopup="menu"
          aria-expanded={exportOpen}
          className="flex items-center gap-1.5 px-2.5 py-1.5 border border-[#1C1C1C]/30 hover:border-[#1C1C1C] transition-colors duration-200 focus:outline-none"
        >
          <Download className="w-3 h-3 text-[#1C1C1C]/60" />
          <Eye className="w-3 h-3 text-[#1C1C1C]/40" />
          <ChevronDown
            className={cn(
              "w-3 h-3 text-[#1C1C1C]/40 transition-transform duration-200",
              exportOpen && "rotate-180"
            )}
          />
        </button>
        {exportOpen && (
          <div
            role="menu"
            className="absolute top-full right-0 mt-0.5 border border-[#1C1C1C] bg-[#F9F8F6] z-50 min-w-full animate-in fade-in duration-150"
          >
            {EXPORT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                role="menuitem"
                onClick={() => {
                  onExport(opt.value);
                  setExportOpen(false);
                }}
                className="w-full text-left px-2.5 py-1.5 font-sans text-[10px] uppercase tracking-[0.15em] text-[#1C1C1C] hover:bg-[#1C1C1C] hover:text-[#F9F8F6] transition-colors duration-200 border-b border-[#1C1C1C]/10 last:border-b-0"
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
