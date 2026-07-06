export function ToggleRow({ id, checked, onChange, children }) {
  return (
    <label>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.currentTarget.checked)}
      />
      {" "}{children}
    </label>
  );
}

export function ColorRow({ label, id, value, onChange }) {
  return (
    <label class="color-row">
      <span>{label}</span>
      <input
        id={id}
        type="color"
        value={value}
        onInput={(e) => onChange(e.currentTarget.value)}
        onChange={(e) => onChange(e.currentTarget.value)}
      />
    </label>
  );
}