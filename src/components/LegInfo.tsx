import type { LegInfo } from './MapView';

export function formatMeters(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1).replace('.', ',')} км` : `${Math.round(m / 10) * 10} м`;
}

/** "340 м · ~5 мин" for the current leg, with the basis of the estimate. */
export function LegLine({ leg }: { leg: LegInfo }) {
  if (leg.sameHall)
    return <div className="leg-line here">📍 Вы в этом Hall — идите по порядку стендов</div>;
  if (!leg.known) return <div className="leg-line muted">Выберите текущий Hall или включите GPS — покажу расстояние</div>;
  return (
    <div className="leg-line">
      <b>
        {leg.approx ? '≈ ' : ''}
        {formatMeters(leg.meters)} · ~{leg.minutes} мин
      </b>
      <span className="muted small">{leg.fromGps ? 'от вашей GPS-позиции' : 'от текущего Hall'} по проходам комплекса</span>
    </div>
  );
}

export function SuggestBanner({ savingM, onReplan, onDismiss }: { savingM: number; onReplan: () => void; onDismiss?: () => void }) {
  return (
    <div className="suggest" role="status">
      <span>
        <b>Есть более короткий маршрут</b> · экономия ≈ {formatMeters(savingM)}
      </span>
      <span className="suggest-btns">
        <button className="btn btn-visit small-btn" onClick={onReplan}>
          Перестроить
        </button>
        {onDismiss && (
          <button className="icon-btn" onClick={onDismiss} aria-label="Скрыть">
            ✕
          </button>
        )}
      </span>
    </div>
  );
}
