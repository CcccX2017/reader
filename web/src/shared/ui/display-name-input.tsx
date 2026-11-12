import { useRef } from 'react';
import { DISPLAY_NAME_MAX_UNITS, clampDisplayName, displayNameUnits } from '../display-name.ts';

/**
 * Display-name field with a live `已输入/上限` count.
 * An unfinished IME word is left intact and trimmed when the character commits.
 */
export function DisplayNameInput({
  id,
  value,
  onChange,
  disabled = false,
  placeholder,
  ariaLabel,
}: {
  id?: string;
  value: string;
  onChange(value: string): void;
  disabled?: boolean;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const composing = useRef(false);
  const units = displayNameUnits(value);
  return (
    <span className="display-name-control">
      <input
        id={id}
        aria-label={ariaLabel}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onCompositionStart={() => { composing.current = true; }}
        onCompositionEnd={(event) => {
          composing.current = false;
          onChange(clampDisplayName(event.currentTarget.value));
        }}
        onChange={(event) => onChange(composing.current ? event.currentTarget.value : clampDisplayName(event.currentTarget.value))}
      />
      <span className="display-name-count" data-over={units > DISPLAY_NAME_MAX_UNITS ? 'true' : undefined} aria-live="polite">
        {units}/{DISPLAY_NAME_MAX_UNITS}
      </span>
    </span>
  );
}
