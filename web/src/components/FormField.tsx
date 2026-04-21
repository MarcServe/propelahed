import type { ReactNode } from "react";

/** Label, optional hint, and control. Matches workspace settings field styling. */
export default function FormField({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="form-field">
      <label className="form-field__label" htmlFor={id}>
        {label}
      </label>
      {hint ? <p className="form-field__hint">{hint}</p> : null}
      <div className="form-field__control">{children}</div>
    </div>
  );
}
