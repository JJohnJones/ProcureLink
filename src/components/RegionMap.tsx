import { useMemo, useState } from 'react';
import DeckGL from '@deck.gl/react';
import { IconLayer, LineLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import BaseMap from 'react-map-gl/maplibre';
import { setWorkerUrl } from 'maplibre-gl';
import mapWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { MapViewState, PickingInfo } from '@deck.gl/core';
import { ArrowUpRight, Building2, Crosshair, Minus, Plus, X } from 'lucide-react';
import { getHospital, getStaff, hospitals, isActive, staff } from '../lib/data';
import { distanceKm, estimateEta } from '../lib/model';
import type { CaseRecord, Hospital } from '../lib/types';

const initial: MapViewState = { longitude: -84.12, latitude: 40.65, zoom: 5.55, pitch: 0, bearing: 0 };
const hospitalCrossAtlas = `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><path d="M23 3h18v20h20v18H41v20H23V41H3V23h20z" fill="#ef4444" stroke="#fff" stroke-width="3" stroke-linejoin="round"/></svg>')}`;
const hospitalCrossMapping = { hospital: { x: 0, y: 0, width: 64, height: 64, anchorX: 32, anchorY: 32, mask: false } };
setWorkerUrl(mapWorkerUrl);
export default function RegionMap({ cases, expanded = false, onCase }: { cases: CaseRecord[]; expanded?: boolean; onCase: (id: string) => void }) {
  const [view, setView] = useState({ ...initial, zoom: expanded ? 6.5 : initial.zoom });
  const [selected, setSelected] = useState<Hospital | null>(null);
  const [mapError, setMapError] = useState(false);
  const [tilesError, setTilesError] = useState(false);
  const kmPerPixel = 40075 * Math.cos(view.latitude * Math.PI / 180) / (512 * 2 ** view.zoom);
  const scaleMagnitude = 10 ** Math.floor(Math.log10(kmPerPixel * 50));
  const scaleKm = [5, 2, 1].map(n => n * scaleMagnitude).find(n => n / kmPerPixel <= 60) || scaleMagnitude;
  const active = cases.filter(isActive);
  const routes = active.filter(c => c.opc_id).map(record => ({
    case: record,
    from: getStaff(record.opc_id)!.coordinates,
    to: getHospital(record.hospital_id).coordinates,
  }));
  const layers = useMemo(() => [
    new LineLayer({ id: 'assignment-routes', data: routes, getSourcePosition: d => d.from, getTargetPosition: d => d.to,
      getColor: [52, 211, 153, 155], getWidth: 2, pickable: true }),
    new IconLayer({ id: 'hospitals', data: hospitals, iconAtlas: hospitalCrossAtlas, iconMapping: hospitalCrossMapping,
      getIcon: () => 'hospital', getPosition: d => d.coordinates, getSize: 25, sizeUnits: 'pixels',
      pickable: true, onClick: (info: PickingInfo<Hospital>) => setSelected(info.object || null) }),
    new TextLayer({ id: 'hospital-labels', data: hospitals.filter(h => !['rita', 'kettering'].includes(h.id)),
      getPosition: d => d.coordinates, getText: d => d.city.toUpperCase(), getColor: [172, 184, 183], getSize: 10,
      getPixelOffset: [17, -2], getTextAnchor: 'start', fontFamily: 'Inter, sans-serif', fontWeight: 500 }),
    new ScatterplotLayer({ id: 'staff-locations', data: staff, getPosition: d => d.coordinates,
      getFillColor: [103, 185, 206], getLineColor: [12, 25, 32], lineWidthMinPixels: 2, stroked: true,
      radiusUnits: 'pixels', getRadius: 4, pickable: true }),
    new TextLayer({ id: 'context-labels', data: [
      { name: 'O H I O', position: [-83.45, 40.42] }, { name: 'I N D I A N A', position: [-85.3, 40.55] },
      { name: 'Fort Wayne', position: [-85.14, 41.08] }, { name: 'Columbus', position: [-82.99, 39.96] },
    ], getPosition: d => d.position, getText: d => d.name, getColor: [100, 110, 118], getSize: 11, fontFamily: 'Inter, sans-serif' }),
  ], [cases]); // Layers are immutable; deck.gl reconciles them by ID.
  return <div className={`region-map ${expanded ? 'expanded-map' : ''}`}>
    {!mapError && <DeckGL viewState={view} onViewStateChange={({ viewState }) => setView(viewState as MapViewState)} controller={{ dragRotate: false, touchRotate: false }}
      layers={layers} onError={error => { console.error('ProcureLink map error:', error); setMapError(true); }} getTooltip={({ object, layer }) => {
        if (!object) return null;
        if (layer?.id === 'staff-locations') return { text: `${object.name}\n${object.location}` };
        if (layer?.id === 'assignment-routes') return { text: `${object.case.case_id} · ~${estimateEta(distanceKm(object.from, object.to))} min\nStraight-line estimate at 65 km/h` };
        return null;
      }}><BaseMap mapStyle={`${import.meta.env.BASE_URL}map-style.json`} attributionControl={false} onError={() => setTilesError(true)} onIdle={() => setTilesError(false)} /></DeckGL>}
    <div className="map-region-label"><span className="live-dot" />WESTERN OHIO<span className="map-live">LIVE COVERAGE</span></div>
    <div className="map-tools"><button title="Zoom in" aria-label="Zoom in" onClick={() => setView(v => ({ ...v, zoom: Math.min(14, v.zoom + .6) }))}><Plus size={16} /></button><button title="Zoom out" aria-label="Zoom out" onClick={() => setView(v => ({ ...v, zoom: Math.max(5, v.zoom - .6) }))}><Minus size={16} /></button><button title="Reset map" aria-label="Reset map" onClick={() => { setView(initial); setSelected(null); }}><Crosshair size={16} /></button></div>
    <div className="map-scale"><span style={{ width: scaleKm / kmPerPixel }} />{scaleKm >= 1 ? `${scaleKm} km` : `${Math.round(scaleKm * 1000)} m`}</div>
    <div className="map-legend"><span><i className="hospital-cross" aria-hidden="true" />Hospitals</span><span><i className="staff-dot" />Staff</span><span><i className="route-line" />Assigned route</span></div>
    <div className="map-attribution"><a href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a> · <a href="https://openmaptiles.org" target="_blank" rel="noreferrer">© OpenMapTiles</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap</a></div>
    {(mapError || tilesError) && <div className="map-fallback">{mapError ? 'WebGL is unavailable in this browser.' : 'Basemap offline. Hospital and staff coordinates remain available.'} Select a facility below.</div>}
    {selected && <div className="hospital-popover"><div className="flex items-start justify-between gap-3"><div><span className="eyebrow">HOSPITAL DETAILS</span><h4>{selected.name}</h4><p>{selected.city}, Ohio · {active.filter(c => c.hospital_id === selected.id).length} active cases</p></div><button className="icon-button" aria-label="Close hospital details" onClick={() => setSelected(null)}><X size={15} /></button></div><div className="hospital-case-list">{active.filter(c => c.hospital_id === selected.id).map(c => <button key={c.case_id} onClick={() => onCase(c.case_id)}><span><strong className="mono">{c.case_id}</strong><small>{c.status}</small></span><ArrowUpRight size={15} /></button>)}{!active.some(c => c.hospital_id === selected.id) && <p>No active referrals.</p>}</div></div>}
    <div className="map-facilities" aria-label="Select a hospital">{hospitals.map(h => <button key={h.id} title={h.name} aria-label={`Show ${h.name} cases`} className={selected?.id === h.id ? 'selected' : ''} onClick={() => { setSelected(h); setView(v => ({ ...v, longitude: h.coordinates[0], latitude: h.coordinates[1], zoom: 8.5 })); }}><Building2 size={12} />{h.short}<span>{active.filter(c => c.hospital_id === h.id).length}</span></button>)}</div>
  </div>;
}
