import { useId, useState, type ReactNode } from "react";
import { useTranslation } from "../shared/i18n";

export function Category({
  title,
  help,
  onReset,
  className,
  children,
}: {
  title: string;
  help?: string;
  onReset?: () => void;
  className?: string;
  children: ReactNode;
}) {
  const tr = useTranslation();
  return (
    <details
      className={["parameter-category", className].filter(Boolean).join(" ")}
    >
      <summary>{tr(title)}</summary>
      <div className="parameter-content">
        {help && <p className="settings-help">{tr(help)}</p>}
        {children}
        {onReset && (
          <button
            type="button"
            className="parameter-reset"
            aria-label={`${tr("Reset")} · ${tr(title)}`}
            onClick={onReset}
          >
            {tr("Reset section")}
          </button>
        )}
      </div>
    </details>
  );
}

export function NumberField({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  compact = false,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number | "any";
  onChange: (value: number) => void;
  compact?: boolean;
}) {
  const tr = useTranslation();
  const [entry, setEntry] = useState<string>();
  return (
    <label>
      {!compact && tr(label)}
      <input
        aria-label={compact ? tr(label) : undefined}
        type="number"
        min={min}
        max={max}
        step={step}
        value={entry ?? value}
        onChange={(e) => setEntry(e.currentTarget.value)}
        onBlur={(e) => {
          const input = e.currentTarget;
          setEntry(undefined);
          if (
            input.validity.valid &&
            Number.isFinite(input.valueAsNumber) &&
            input.valueAsNumber !== value
          )
            onChange(input.valueAsNumber);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && e.currentTarget.reportValidity())
            e.currentTarget.blur();
        }}
      />
    </label>
  );
}

export function Chance({
  label,
  value,
  onChange,
  min = 0,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
}) {
  const tr = useTranslation();
  const percent = Number((value * 100).toPrecision(15));
  return (
    <SliderField
      label={label}
      numericLabel={`${tr(label)} (%)`}
      value={percent}
      min={min}
      max={100}
      numericMin={min > 0 ? Number.MIN_VALUE : min}
      numericStep="any"
      unit="%"
      valueText={`${percent}%`}
      onChange={(percent) => onChange(percent / 100)}
    />
  );
}

export function SliderField({
  label,
  numericLabel,
  value,
  min,
  max,
  numericMin = min,
  numericStep = 1,
  valueText,
  unit,
  curved,
  onChange,
}: {
  label: string;
  numericLabel?: string;
  value: number;
  min: number;
  max: number;
  numericMin?: number;
  numericStep?: number | "any";
  valueText?: string;
  unit?: string;
  curved?: boolean;
  onChange: (value: number) => void;
}) {
  const tr = useTranslation();
  const id = useId();
  return (
    <div className="parameter-slider">
      <label htmlFor={id}>{tr(label)}</label>
      <input
        id={id}
        type="range"
        aria-valuetext={valueText ?? String(value)}
        min={curved ? 0 : min}
        max={curved ? 100 : max}
        step={1}
        value={
          curved
            ? Math.round(Math.sqrt((value - min) / (max - min)) * 100)
            : value
        }
        onChange={(e) => {
          const position = e.currentTarget.valueAsNumber;
          onChange(
            curved
              ? Math.round(min + (max - min) * (position / 100) ** 2)
              : position,
          );
        }}
      />
      <div className="slider-amount">
        <NumberField
          compact
          label={numericLabel ?? `${tr(label)} · ${tr("Value")}`}
          value={value}
          min={numericMin}
          max={max}
          step={numericStep}
          onChange={onChange}
        />
        {unit && <span aria-hidden="true">{tr(unit)}</span>}
      </div>
    </div>
  );
}

export function Toggle({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  const tr = useTranslation();
  return (
    <label className="check">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {tr(label)}
    </label>
  );
}

export function Choice<T extends string | number>({
  label,
  value,
  items,
  onChange,
  disabled,
}: {
  label: string;
  value: T;
  items: readonly (readonly [T, string])[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  const tr = useTranslation();
  return (
    <label>
      {tr(label)}
      <select
        aria-label={tr(label)}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          const selected = items.find(
            ([value]) => String(value) === e.target.value,
          );
          if (selected) onChange(selected[0]);
        }}
      >
        {items.map(([value, label]) => (
          <option key={value} value={value}>
            {tr(label)}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Picks<T extends string | number>({
  label,
  items,
  values,
  onChange,
  minimum = 1,
  disabledItems = [],
}: {
  label: string;
  items: readonly (readonly [T, string])[];
  values: readonly T[];
  onChange: (values: T[]) => void;
  minimum?: number;
  disabledItems?: readonly T[];
}) {
  const tr = useTranslation();
  return (
    <fieldset className="parameter-picks">
      <legend>{tr(label)}</legend>
      {items.map(([id, name]) => (
        <Toggle
          key={id}
          label={name}
          checked={values.includes(id)}
          disabled={
            disabledItems.includes(id) ||
            (values.includes(id) && values.length <= minimum)
          }
          onChange={(enabled) =>
            onChange(
              enabled
                ? [...values, id]
                : values.filter((value) => value !== id),
            )
          }
        />
      ))}
    </fieldset>
  );
}

export function Weights<T extends string | number>({
  label,
  items,
  values,
  onChange,
  required = [],
  unavailable = [],
  minimum = 1,
}: {
  label: string;
  items: readonly (readonly [T, string])[];
  values: ReadonlyArray<{ readonly value: T; readonly weight: number }>;
  onChange: (values: { value: T; weight: number }[]) => void;
  required?: readonly T[];
  unavailable?: readonly T[];
  minimum?: number;
}) {
  const tr = useTranslation();
  const heaviest = Math.max(0.000001, ...values.map(({ weight }) => weight));
  return (
    <fieldset className="parameter-picks parameter-weights">
      <legend>{tr(label)}</legend>
      <p className="weight-key">
        {tr("Relative weights · longer bars mean more preference")}
      </p>
      {items.map(([id, name]) => {
        const entry = values.find((entry) => entry.value === id);
        const entries = values.filter((value) => value.value !== id);
        return (
          <div className="parameter-weight" key={id}>
            <Toggle
              label={name}
              checked={!!entry}
              disabled={
                required.includes(id) ||
                (entry ? values.length <= minimum : unavailable.includes(id))
              }
              onChange={(enabled) =>
                onChange(
                  enabled ? [...values, { value: id, weight: 1 }] : entries,
                )
              }
            />
            {entry && (
              <>
                <div className="parameter-weight-track" aria-hidden="true">
                  <span
                    style={{ width: `${(entry.weight / heaviest) * 100}%` }}
                  />
                </div>
                <NumberField
                  compact
                  label={`${tr("Weight")} · ${tr(name)}`}
                  value={entry.weight}
                  min={0.000001}
                  max={1000}
                  step="any"
                  onChange={(weight) =>
                    onChange(
                      values.map((value) =>
                        value.value === id ? { ...value, weight } : value,
                      ),
                    )
                  }
                />
              </>
            )}
          </div>
        );
      })}
    </fieldset>
  );
}
