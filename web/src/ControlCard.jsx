export function ControlCard({ title, children }) {
  return (
    <div class="control-card">
      {title ? <div class="control-card__title">{title}</div> : null}
      {children}
    </div>
  );
}
