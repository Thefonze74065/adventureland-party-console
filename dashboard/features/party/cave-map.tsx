'use client';
import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import type {
  CaveObservation,
  DungeonView,
} from '../../../runtime/dungeons/contracts';
import { API } from './api';
import type { MapFrame } from './map-frame';
import { MapCanvas } from './map-canvas';
import { dungeonButton } from './dungeon-settings';

export function CaveMap({
  view,
  cave,
  action,
  actionsReady,
  waitingForReports,
  error,
}: {
  view: DungeonView;
  cave: NonNullable<CaveObservation['cave']>;
  action: (body: Record<string, unknown>) => Promise<unknown>;
  actionsReady: boolean;
  waitingForReports: boolean;
  error: string;
}) {
  const [open, setOpen] = useState(false),
    [adding, setAdding] = useState(false);
  const [waypoint, setWaypoint] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [frames, setFrames] = useState<Record<string, MapFrame>>({});
  const [busy, setBusy] = useState(false);
  const [nativeSize, setNativeSize] = useState(false);
  const names = view.state.participants.join(',');
  const map = 'zone_' + cave.run + '_' + cave.floor;
  useEffect(() => {
    if (!open) return;
    const streams = names.split(',').map((name) => {
      const stream = new EventSource(
        `${API}/map-stream/${encodeURIComponent(name)}`,
      );
      stream.onmessage = (event) => {
        try {
          const frame: MapFrame = JSON.parse(event.data);
          if (frame.map === map)
            setFrames((old) => ({ ...old, [name]: frame }));
        } catch {
          /* next frame */
        }
      };
      return stream;
    });
    return () => streams.forEach((s) => s.close());
  }, [open, names, map]);
  const frame = frames[view.state.participants[0]]?.definition ? frames[view.state.participants[0]] : Object.values(frames).find((f) => f.definition?.name === map);
  const pins = [
    ...cave.points
      .filter((p) => p.map === map && !p.exit)
      .map((p) => ({
        x: p.x,
        y: p.y,
        label: p.label,
        color: p.done ? '#4ade80' : p.required ? '#fb923c' : '#facc15',
      })),
    ...Object.values(frames).map((f) => ({
      x: f.x,
      y: f.y,
      label: f.name,
      color: '#67e8f9',
    })),
    ...(waypoint ? [{ ...waypoint, label: 'Waypoint', color: '#f472b6' }] : []),
  ];
  return (
    <>
      <button className={dungeonButton + ' mt-2'} onClick={() => setOpen(true)}>
        View full map
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[min(1000px,calc(100vw-2rem))] max-w-none border-emerald-700 bg-[#081713] text-emerald-50 sm:max-w-none [&_[data-slot=dialog-close]]:border [&_[data-slot=dialog-close]]:border-emerald-600 [&_[data-slot=dialog-close]]:bg-slate-950 [&_[data-slot=dialog-close]]:text-emerald-50 [&_[data-slot=dialog-close]]:hover:bg-emerald-950">
          <DialogHeader>
            <DialogTitle>
              Cave of Many Dreams — Floor {cave.floor + 1}
            </DialogTitle>
            <DialogDescription className="text-slate-300">
              Cyan: party · Orange: required · Green: complete · Yellow: events
              · Pink: waypoint
            </DialogDescription>
          </DialogHeader>
          <div className="h-[min(600px,calc(100vh-16rem))] overflow-hidden rounded border border-emerald-800 bg-[#07110f]">
            <MapCanvas
              definition={frame?.definition || null}
              frame={
                frame
                  ? {
                      ...frame,
                      entities: Array.from(
                        new Map(
                          Object.values(frames)
                            .flatMap((f) => f.entities)
                            .map((e) => [e.id, e]),
                        ).values(),
                      ),
                    }
                  : null
              }
              previous={null}
              receivedAt={0}
              scale={1}
              detailed
              fullMap={!nativeSize}
              pins={pins}
              active={open}
              fps={15}
              onWaypoint={
                adding
                  ? (point) => {
                      setWaypoint(point);
                      setAdding(false);
                    }
                  : undefined
              }
            />
          </div>
          <div className="flex flex-wrap gap-3 text-sm">
            {Object.values(frames).map((f) => (
              <span key={f.name}>{f.name}</span>
            ))}
          </div>
          <div className="h-5 text-sm text-amber-200">
            {waitingForReports && <output className="block">Waiting for fresh participant reports.</output>}
          </div>
          <div className="flex items-center gap-2">
            <button className={dungeonButton} disabled={!frame} onClick={()=>setNativeSize(value=>!value)}>{nativeSize?'Fit full floor':'Native-size view'}</button>
            <button
              className={dungeonButton}
              disabled={!frame || !actionsReady}
              onClick={() => setAdding(true)}
            >
              Add waypoint
            </button>
            <button
              className={dungeonButton}
              disabled={!waypoint || busy || !actionsReady || cave.paused}
              onClick={async () => {
                if (!waypoint || !actionsReady || cave.paused) return;
                setBusy(true);
                try {
                  if (await action({ action: 'waypoint', map, ...waypoint }))
                    setOpen(false);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Set waypoint
            </button>
            <span className="text-sm text-slate-300">
              {adding
                ? 'Click the map to place your waypoint.'
                : waypoint
                  ? `${Math.round(waypoint.x)}, ${Math.round(waypoint.y)}`
                  : 'One waypoint at a time.'}
            </span>
          </div>
          {error && (
            <p role="alert" className="text-red-200">
              {error}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
