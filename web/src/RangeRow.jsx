/*
 * Tiny presentational row used by ControlsPanel — controlled <input type="range">
 * with a label + numeric readout. The owning panel owns the state and passes
 * the current value + onChange down.
 */

export function RangeRow({ label, id, min, max, step, value, onChange, format }) {
  const display = format ? format(value) : value;
  return (
    <label class="range-row">
      <span>{label}</span>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onInput={(e) => onChange(Number(e.currentTarget.value))}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
      />
      <output for={id}>{display}</output>
    </label>
  );
}