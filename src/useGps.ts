import { useEffect, useState } from 'react';

export interface GpsFix {
  lat: number;
  lon: number;
  acc: number;
  ts: number;
  /** Compass heading of movement (degrees from north) when the device reports it while moving. */
  heading?: number;
}

export type GpsStatus = 'off' | 'waiting' | 'ok' | 'denied' | 'unavailable' | 'error';

/** Live position via navigator.geolocation.watchPosition while `enabled`. */
export function useGps(enabled: boolean): { status: GpsStatus; fix: GpsFix | null; message: string } {
  const [status, setStatus] = useState<GpsStatus>('off');
  const [fix, setFix] = useState<GpsFix | null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!enabled) {
      setStatus('off');
      return;
    }
    if (!('geolocation' in navigator)) {
      setStatus('unavailable');
      setMessage('GPS недоступен в этом браузере.');
      return;
    }
    setStatus((s) => (s === 'ok' ? s : 'waiting'));
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const h = pos.coords.heading;
        const moving = (pos.coords.speed ?? 0) > 0.5;
        setFix({ lat: pos.coords.latitude, lon: pos.coords.longitude, acc: pos.coords.accuracy, ts: pos.timestamp, heading: moving && h !== null && !Number.isNaN(h) ? h : undefined });
        setStatus('ok');
        setMessage('');
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setStatus('denied');
          setMessage('Доступ к геопозиции запрещён. Разрешите его в настройках Safari → Геопозиция.');
        } else {
          setStatus((s) => (s === 'ok' ? s : 'error'));
          setMessage('Не удалось получить позицию — жду сигнал GPS…');
        }
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [enabled]);

  return { status, fix, message };
}
