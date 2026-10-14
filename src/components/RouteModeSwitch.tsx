import { ROUTE_MODES, type RouteMode } from '../route';

export function RouteModeSwitch({ mode, onChange }: { mode: RouteMode; onChange: (m: RouteMode) => void }) {
  return (
    <div className="segmented" role="tablist" aria-label="Режим маршрута">
      {ROUTE_MODES.map((m) => (
        <button key={m.id} role="tab" aria-selected={mode === m.id} className={mode === m.id ? 'on' : ''} onClick={() => onChange(m.id)}>
          {m.label}
        </button>
      ))}
    </div>
  );
}
