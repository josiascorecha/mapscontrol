import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';
import type { Block } from '../api';
import { useSession } from '../session';

function tiles(map: L.Map, url: string, attribution: string) {
  L.tileLayer(url, { maxZoom: 19, attribution }).addTo(map);
}

function numberIcon(n: number, cls = '') {
  return L.divIcon({ className: `block-marker ${cls}`, html: '', iconSize: [38, 38] });
}

function withText(icon: L.DivIcon, text: string): L.DivIcon {
  // Conteúdo via textContent (evita injeção de HTML).
  const el = document.createElement('div');
  el.textContent = text;
  icon.options.html = el;
  return icon;
}

/** Mapa do território: marcadores numerados por quadra. */
export function TerritoryMap({ blocks, onOpen }: { blocks: Block[]; onOpen: (b: Block) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const { config } = useSession();
  const openRef = useRef(onOpen);
  openRef.current = onOpen;

  useEffect(() => {
    if (!ref.current || !config) return;
    const map = L.map(ref.current, { zoomControl: true, attributionControl: true });
    tiles(map, config.tileUrl, config.tileAttribution);
    const pts = blocks.filter((b) => b.lat != null && b.lng != null);
    const group: L.LatLngExpression[] = [];
    for (const b of pts) {
      const done = (b.total ?? 0) > 0 && (b.pending ?? 0) === 0 && (b.letter ?? 0) === 0;
      const m = L.marker([b.lat!, b.lng!], {
        icon: withText(numberIcon(b.number, done ? 'done' : ''), String(b.number)),
        title: `Quadra ${b.number}`,
        alt: `Quadra ${b.number}`,
        keyboard: true,
      }).addTo(map);
      const box = document.createElement('div');
      const h = document.createElement('strong');
      h.textContent = `Quadra ${b.number}${b.name ? ` — ${b.name}` : ''}`;
      const info = document.createElement('div');
      info.className = 'small muted';
      info.textContent = `${b.total ?? 0} endereço(s) · ${b.pending ?? 0} pendente(s) · ${b.letter ?? 0} com carta`;
      const actions = document.createElement('div');
      actions.className = 'popup-actions';
      const open = document.createElement('button');
      open.className = 'btn small';
      open.textContent = 'Abrir endereços';
      open.onclick = () => openRef.current(b);
      actions.append(open);
      if (b.googleMapsUrl) {
        const g = document.createElement('a');
        g.className = 'btn secondary small';
        g.href = b.googleMapsUrl;
        g.target = '_blank';
        g.rel = 'noopener noreferrer';
        g.textContent = 'Abrir no Google Maps';
        actions.append(g);
      }
      box.append(h, info, actions);
      m.bindPopup(box, { minWidth: 220 });
      group.push([b.lat!, b.lng!]);
    }
    if (group.length > 1) map.fitBounds(L.latLngBounds(group), { padding: [36, 36], maxZoom: 18 });
    else if (group.length === 1) map.setView(group[0], 17);
    else map.setView([-14.2, -51.9], 4); // Brasil
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      map.remove();
    };
  }, [blocks, config]);

  return <div className="map" ref={ref} role="application" aria-label="Mapa das quadras do território" />;
}

/** Mapa para posicionar/ajustar o marcador de uma quadra (toque no mapa ou arraste o marcador). */
export function PickerMap({
  value,
  number,
  others,
  onChange,
}: {
  value: { lat: number; lng: number } | null;
  number: number;
  others: Block[];
  onChange: (v: { lat: number; lng: number }) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const cb = useRef(onChange);
  cb.current = onChange;
  const { config } = useSession();

  useEffect(() => {
    if (!ref.current || !config) return;
    const map = L.map(ref.current);
    mapRef.current = map;
    tiles(map, config.tileUrl, config.tileAttribution);
    const pts: L.LatLngExpression[] = [];
    for (const o of others) {
      if (o.lat == null || o.lng == null) continue;
      L.marker([o.lat, o.lng], { icon: withText(numberIcon(o.number), String(o.number)), opacity: 0.55, interactive: false }).addTo(map);
      pts.push([o.lat, o.lng]);
    }
    if (value) map.setView([value.lat, value.lng], 17);
    else if (pts.length) map.fitBounds(L.latLngBounds(pts), { padding: [30, 30], maxZoom: 17 });
    else map.setView([-14.2, -51.9], 4);
    map.on('click', (e: L.LeafletMouseEvent) => cb.current({ lat: round(e.latlng.lat), lng: round(e.latlng.lng) }));
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, others]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!value) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }
    if (!markerRef.current) {
      markerRef.current = L.marker([value.lat, value.lng], {
        draggable: true,
        icon: withText(numberIcon(number, 'editing'), String(number || '?')),
      }).addTo(map);
      markerRef.current.on('dragend', () => {
        const p = markerRef.current!.getLatLng();
        cb.current({ lat: round(p.lat), lng: round(p.lng) });
      });
      map.setView([value.lat, value.lng], Math.max(map.getZoom(), 16));
    } else {
      markerRef.current.setLatLng([value.lat, value.lng]);
    }
  }, [value, number]);

  return <div className="map tall" ref={ref} role="application" aria-label="Toque no mapa para posicionar a quadra" />;
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;
