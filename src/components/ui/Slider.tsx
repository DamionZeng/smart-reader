"use client";

import { useId, useState, useEffect, useCallback } from "react";
import { cn } from "@/utils/cn";

interface SliderProps {
  /** Current value (controlled) */
  value?: number;
  /** Default value (uncontrolled) */
  defaultValue?: number;
  /** Minimum allowed value */
  min?: number;
  /** Maximum allowed value */
  max?: number;
  /** Step increment */
  step?: number;
  /** Called when the value changes */
  onChange?: (value: number) => void;
  /** Visible label above the slider */
  label?: string;
  /** Show the current numeric value next to the label */
  showValue?: boolean;
  /** Unit suffix displayed after the value (e.g. "%", "px") */
  unit?: string;
  /** Formatter for the displayed value */
  formatValue?: (value: number) => string;
  /** Disable the slider */
  disabled?: boolean;
  /** Optional helper text below the slider */
  hint?: string;
  /** Optional className for the root element */
  className?: string;
}

/**
 * Editorial-style Slider.
 *
 * Design tokens (see .trae/rules/ui-design.md):
 *   - 1px track, no rounded corners
 *   - 12x12 square thumb with 1px black border
 *   - Filled portion is solid #1C1C1C
 *   - No shadows, no gradients
 *   - Hover: thumb scales to 1.25 and fills with #1C1C1C
 *
 * Implementation note:
 *   The native <input type="range"> is overlaid on a pair of
 *   absolutely-positioned divs (track + fill) so we can keep the
 *   editorial aesthetic without resorting to gradients on the
 *   input's own background (which is forbidden by the style kit).
 */
export function Slider({
  value: controlledValue,
  defaultValue,
  min = 0,
  max = 100,
  step = 1,
  onChange,
  label,
  showValue = false,
  unit = "",
  formatValue,
  disabled = false,
  hint,
  className,
}: SliderProps) {
  const id = useId();
  const isControlled = controlledValue !== undefined;
  const [internalValue, setInternalValue] = useState<number>(
    controlledValue ?? defaultValue ?? min
  );

  // Keep internal state in sync with controlled updates
  useEffect(() => {
    if (isControlled) {
      setInternalValue(controlledValue as number);
    }
  }, [controlledValue, isControlled]);

  const value = isControlled ? (controlledValue as number) : internalValue;
  const percent = max === min ? 0 : ((value - min) / (max - min)) * 100;

  const handleChange = useCallback(
    (next: number) => {
      if (disabled) return;
      if (!isControlled) setInternalValue(next);
      onChange?.(next);
    },
    [disabled, isControlled, onChange]
  );

  const display =
    formatValue?.(value) ?? `${Number.isInteger(value) ? value : value.toFixed(2)}${unit}`;

  return (
    <div className={cn("w-full", className)}>
      {(label || showValue) && (
        <div className="flex items-baseline justify-between mb-3">
          {label && (
            <label
              htmlFor={id}
              className="font-sans text-[10px] uppercase tracking-[0.2em] text-[#1C1C1C]/60"
            >
              {label}
            </label>
          )}
          {showValue && (
            <span className="font-mono text-xs text-[#1C1C1C] tabular-nums">
              {display}
            </span>
          )}
        </div>
      )}

      <div className="relative h-6 flex items-center select-none">
        {/* Track (unfilled) */}
        <div
          aria-hidden
          className="absolute inset-x-0 h-px bg-[#1C1C1C]/20"
        />
        {/* Track (filled) */}
        <div
          aria-hidden
          className="absolute left-0 h-px bg-[#1C1C1C] transition-[width] duration-150 ease-out"
          style={{ width: `${percent}%` }}
        />
        {/* Native range input for accessibility / keyboard support */}
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(e) => handleChange(Number(e.target.value))}
          onInput={(e) => handleChange(Number((e.target as HTMLInputElement).value))}
          aria-label={label}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={value}
          className="editorial-slider relative w-full h-6 opacity-100"
        />
      </div>

      {hint && (
        <p className="mt-2 font-sans text-[10px] uppercase tracking-[0.2em] text-[#1C1C1C]/40">
          {hint}
        </p>
      )}
    </div>
  );
}
