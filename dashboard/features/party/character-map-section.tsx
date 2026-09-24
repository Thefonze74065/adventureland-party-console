"use client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ChevronDown, ChevronRight, Maximize2 } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import { API } from "./api";
import { Char } from "./char";
import { MapCanvas } from "./map-canvas";
import { useMapDefinition, useVisible } from "./query-cache";
import { MapFrame } from "./map-frame";
import { receiveMapFrame, type MapRenderBuffer } from "./map-render-buffer";
import { useCharacterData } from './dashboard-live';
import { committedLiveRecord } from './live-metrics';

// Beyond the initial fallback, only `char.name` matters here: map/x/y come
// from this component's own live `position` subscription below, so a fresh
// `char` object on every vitals-driven parent render (map/x/y get overwritten
// anyway once position data arrives) would otherwise force this fairly
// expensive live-map component to re-render for data it never actually uses.
export const CharacterMapSection = memo(function CharacterMapSection({ char: base }: { char: Char }) {
  const position = useCharacterData(base.name, 'position');
  useEffect(() => { committedLiveRecord(base.name, 'position'); }, [base.name, position]);
  const char = { ...base, ...position };
  const [open, setOpen] = useState(false),
    [large, setLarge] = useState(false);
  const definitionQuery = useMapDefinition(char.map, open);
  const definition = definitionQuery.data || null;
  const visible = useVisible();
  const buffer = useRef<MapRenderBuffer>({ frame: null, previous: null, receivedAt: 0 });
  const [streamState, setStreamState] = useState("loading");
  useEffect(() => {
    if (!open || !visible) return;
    Object.assign(buffer.current, { frame: null, previous: null, receivedAt: 0 });
    const stream = new EventSource(`${API}/map-stream/${encodeURIComponent(char.name)}`);
    stream.onopen = () => setStreamState("live");
    stream.onerror = () => setStreamState("reconnecting");
    stream.onmessage = (message) => {
      try {
        const next: MapFrame = JSON.parse(message.data),
          now = Date.now();
        if (next.map !== char.map) return;
        receiveMapFrame(buffer.current, next, performance.now(), now);
      } catch {
        /* retry on next frame */
      }
    };
    return () => stream.close();
  }, [open, visible, char.name, char.map]);
  return (
    <div className="mt-1">
      <div className="flex items-center gap-1 font-mono text-xs text-cyan-200/65">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="rounded p-0.5 hover:bg-cyan-300/10"
          aria-label={open ? "Collapse live map" : "Expand live map"}
        >
          {open ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </button>
        <span>
          {char.map} [{Math.round(char.x)}, {Math.round(char.y)}]
        </span>
      </div>
      {open ? (
        <div className="relative mt-2 aspect-[4/3] overflow-hidden rounded-md border border-emerald-800/80 bg-[#07110f]">
          <MapCanvas
            definition={definition}
            frame={null}
            previous={null}
            receivedAt={0}
            buffer={buffer}
            fps={20}
            active={open && visible && !large}
            scale={1 / 3}
            detailed={false}
          />
          <button
            type="button"
            onClick={() => setLarge(true)}
            className="absolute right-2 top-2 rounded border border-emerald-700 bg-[#07110f]/90 p-1.5 text-emerald-200 hover:bg-emerald-950"
            aria-label="Open native-size map"
          >
            <Maximize2 className="h-4 w-4" />
          </button>
          {streamState !== "live" ? (
            <span className="absolute bottom-2 left-2 rounded bg-black/70 px-2 py-1 font-mono text-[10px] text-amber-200">
              {streamState}
            </span>
          ) : null}
        </div>
      ) : null}
      <Dialog open={large} onOpenChange={setLarge}>
        <DialogContent className="w-[min(804px,calc(100vw-2rem))] max-w-none gap-0 overflow-hidden border-2 border-emerald-700 bg-[#081713] p-0 text-emerald-50 sm:max-w-none [&_[data-slot=dialog-close]]:right-3 [&_[data-slot=dialog-close]]:top-3 [&_[data-slot=dialog-close]]:text-emerald-100 [&_[data-slot=dialog-close]]:hover:bg-emerald-900">
          <DialogHeader className="border-b border-emerald-800 px-5 py-3">
            <DialogTitle className="text-emerald-50">
              {char.name} — {char.map}
            </DialogTitle>
          </DialogHeader>
          <div className="h-[min(600px,calc(100vh-8rem))] w-full overflow-hidden bg-[#07110f]">
            <MapCanvas
              definition={definition}
              frame={null}
              previous={null}
              receivedAt={0}
              buffer={buffer}
              fps={20}
              active={open && visible && large}
              scale={1}
              detailed
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}, (previous, next) => previous.char.name === next.char.name);
