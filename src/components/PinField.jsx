import { useId, useState } from "react";

export function PinField({
  label,
  value,
  onChange,
  autoComplete,
  disabled,
  autoFocus,
}) {
  const id = useId();
  const [caret, setCaret] = useState(0);
  const trackCaret = (event) => setCaret(event.currentTarget.selectionStart);

  return (
    <div>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <div className="pin-field">
        <input
          id={id}
          type="password"
          inputMode="numeric"
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          value={value}
          disabled={disabled}
          onFocus={trackCaret}
          onSelect={trackCaret}
          onChange={(event) => {
            const { value: raw, selectionStart } = event.currentTarget;
            onChange(raw.replace(/\D/g, "").slice(0, 4));
            setCaret(raw.slice(0, selectionStart).replace(/\D/g, "").length);
          }}
        />
        <div className="pin-slots" aria-hidden="true">
          {Array.from({ length: 4 }, (_, index) => (
            <span
              className={index === Math.min(caret, 3) ? "pin-active" : ""}
              key={index}
            >
              {value[index] ? "●" : ""}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
