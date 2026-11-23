import { LoaderCircle } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

/** Same button styles as other controls; status text is supplied by the caller. */
export function MidiConnectionButton({
  busy,
  icon,
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  busy: boolean;
  icon: ReactNode;
}) {
  return (
    <button
      {...props}
      type="button"
      disabled={disabled || busy}
      aria-busy={busy}
    >
      {busy ? (
        <LoaderCircle className="midi-spinner" size={16} aria-hidden="true" />
      ) : (
        icon
      )}
      {children}
    </button>
  );
}
