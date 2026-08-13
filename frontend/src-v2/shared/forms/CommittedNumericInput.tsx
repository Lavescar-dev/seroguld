import { useEffect, useRef, useState, type InputHTMLAttributes } from 'react';

import { formatNumericDraftValue, parseNumericDraft, type NumericDraftRules } from './numericDraft';

type CommittedNumericInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'value' | 'defaultValue' | 'onChange' | 'onBlur' | 'onKeyDown'
> & {
  value: string | number | null | undefined;
  rules: NumericDraftRules;
  onCommit: (value: number | null, canonical: string) => void;
};

export function CommittedNumericInput({ value, rules, onCommit, id, className, ...inputProps }: CommittedNumericInputProps) {
  const formattedValue = formatNumericDraftValue(value, rules);
  const [draft, setDraft] = useState(formattedValue);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [focused, setFocused] = useState(false);
  const committedRef = useRef(formattedValue);
  const errorId = id ? `${id}-error` : undefined;

  useEffect(() => {
    if (!dirty && !focused) {
      setDraft(formattedValue);
      committedRef.current = formattedValue;
    }
  }, [dirty, focused, formattedValue]);

  const commit = () => {
    if (!dirty && draft === committedRef.current) return;
    const result = parseNumericDraft(draft, rules);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onCommit(result.value, result.canonical);
    committedRef.current = result.canonical;
    setDraft(result.canonical);
    setDirty(false);
    setError(null);
  };

  const revert = () => {
    setDraft(committedRef.current);
    setDirty(false);
    setError(null);
  };

  return (
    <>
      <input
        {...inputProps}
        id={id}
        type="text"
        inputMode={rules.kind === 'integer' ? 'numeric' : 'decimal'}
        value={draft}
        onFocus={() => setFocused(true)}
        onChange={(event) => {
          setDraft(event.target.value);
          setDirty(true);
          setError(null);
        }}
        onBlur={() => {
          setFocused(false);
          commit();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            revert();
          }
        }}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={className}
      />
      {error ? <span id={errorId} role="alert" className="mt-1 block text-[11px] font-medium text-red-600">{error}</span> : null}
    </>
  );
}
