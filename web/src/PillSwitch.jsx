export function PillSwitch({ options, value, onChange, compact, ariaLabel }) {
  return (
    <div
      class={`pill-switch${compact ? " pill-switch--compact" : ""}`}
      role="group"
      aria-label={ariaLabel}
    >
      {options.map((opt) => (
        <button
          key={opt.id}
          type="button"
          class={value === opt.id ? "active" : ""}
          aria-pressed={value === opt.id ? "true" : "false"}
          onClick={() => onChange(opt.id)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
