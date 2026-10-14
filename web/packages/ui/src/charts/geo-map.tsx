import * as React from "react";
import { geoEqualEarth, geoPath, type GeoProjection } from "d3-geo";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import { cn } from "../lib/cn";
import { ChartTooltipBox } from "./chart-kit";

/** ISO 3166-1 alpha-2 → numeric id used by world-atlas. */
const ISO_NUMERIC: Record<string, string> = {
  CN: "156", HK: "344", MO: "446", TW: "158", JP: "392", KR: "410", KP: "408", SG: "702", MY: "458", TH: "764",
  VN: "704", ID: "360", PH: "608", MM: "104", KH: "116", LA: "418", BN: "096", IN: "356", PK: "586", BD: "050",
  LK: "144", NP: "524", MN: "496", KZ: "398", UZ: "860", AU: "036", NZ: "554", US: "840", CA: "124", MX: "484",
  BR: "076", AR: "032", CL: "152", CO: "170", PE: "604", VE: "862", GB: "826", IE: "372", FR: "250", DE: "276",
  NL: "528", BE: "056", LU: "442", CH: "756", AT: "040", IT: "380", ES: "724", PT: "620", SE: "752", NO: "578",
  FI: "246", DK: "208", IS: "352", PL: "616", CZ: "203", SK: "703", HU: "348", RO: "642", BG: "100", GR: "300",
  TR: "792", UA: "804", BY: "112", RU: "643", IL: "376", SA: "682", AE: "784", QA: "634", KW: "414", IR: "364",
  IQ: "368", EG: "818", ZA: "710", NG: "566", KE: "404", MA: "504", DZ: "012", TN: "788", ET: "231", GH: "288",
  LT: "440", LV: "428", EE: "233", RS: "688", HR: "191", SI: "705", BA: "070", AL: "008", MK: "807", MD: "498",
  GE: "268", AM: "051", AZ: "031", CY: "196", JO: "400", LB: "422", SY: "760", OM: "512", YE: "887", AF: "004",
  KG: "417", TJ: "762", TM: "795", PG: "598", FJ: "242", CU: "192", DO: "214", GT: "320", CR: "188", PA: "591",
  EC: "218", BO: "068", PY: "600", UY: "858",
};

/** Places too small for the 1:110m outlines; drawn as dots. [lon, lat] */
const POINTS: Record<string, [number, number]> = {
  HK: [114.17, 22.32],
  MO: [113.55, 22.2],
  SG: [103.82, 1.35],
  BH: [50.56, 26.07],
  MT: [14.4, 35.9],
  LU: [6.13, 49.61],
};

type Topology = {
  type: "Topology";
  objects: Record<string, unknown>;
  arcs: unknown[];
  transform?: unknown;
};

let worldPromise: Promise<FeatureCollection<Geometry, { name: string }>> | null = null;
function loadWorld() {
  worldPromise ??= Promise.all([import("world-atlas/countries-110m.json"), import("topojson-client")]).then(([topo, tc]) => {
    const t = (topo as unknown as { default: Topology }).default;
    const fc = tc.feature(t as never, t.objects.countries as never) as unknown as FeatureCollection<Geometry, { name: string }>;
    return { ...fc, features: fc.features.filter((f) => f.id !== "010") }; // drop Antarctica
  });
  return worldPromise;
}

export interface GeoDatum {
  code: string;
  name: string;
  value: number;
}

export interface GeoMarker {
  id: string;
  label: string;
  lon: number;
  lat: number;
  status?: "online" | "offline" | "planned";
}

const SEQ = ["var(--seq-1)", "var(--seq-2)", "var(--seq-3)", "var(--seq-4)", "var(--seq-5)"];

export function GeoMap({
  data = [],
  markers = [],
  formatValue = (v) => v.toLocaleString(),
  className,
  height = 300,
  focus = "world",
  legendLabel,
}: {
  data?: GeoDatum[];
  markers?: GeoMarker[];
  formatValue?: (v: number) => string;
  className?: string;
  height?: number;
  /** "apac" crops to Asia-Pacific + US west coast. */
  focus?: "world" | "apac";
  legendLabel?: string;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [width, setWidth] = React.useState(0);
  const [world, setWorld] = React.useState<FeatureCollection<Geometry, { name: string }> | null>(null);
  const [hover, setHover] = React.useState<{ x: number; y: number; name: string; value: number | null } | null>(null);

  React.useEffect(() => {
    let alive = true;
    void loadWorld().then((w) => alive && setWorld(w));
    return () => {
      alive = false;
    };
  }, []);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => setWidth(Math.round(entries[0]?.contentRect.width ?? 0)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const byId = React.useMemo(() => {
    const m = new Map<string, GeoDatum>();
    for (const d of data) {
      const id = ISO_NUMERIC[d.code.toUpperCase()];
      if (id) m.set(id, d);
    }
    return m;
  }, [data]);

  const max = React.useMemo(() => Math.max(0, ...data.map((d) => d.value)), [data]);
  const step = (v: number) => {
    if (v <= 0 || max <= 0) return null;
    // Square-root scale keeps small countries visible next to a dominant one.
    const idx = Math.min(SEQ.length - 1, Math.floor(Math.sqrt(v / max) * SEQ.length));
    return SEQ[idx];
  };

  const projection: GeoProjection | null = React.useMemo(() => {
    if (!world || width === 0) return null;
    const p = geoEqualEarth();
    if (focus === "apac") {
      p.rotate([-150, 0]);
      const box: FeatureCollection = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {},
            geometry: { type: "MultiPoint", coordinates: [[60, 52], [180, -46], [-115, 50], [95, -10]] },
          },
        ],
      };
      p.fitExtent([[8, 8], [width - 8, height - 8]], box);
    } else {
      p.fitExtent([[4, 4], [width - 4, height - 4]], world);
    }
    return p;
  }, [world, width, height, focus]);

  const path = projection ? geoPath(projection) : null;

  return (
    <div ref={ref} className={cn("relative w-full select-none", className)} style={{ height }} onMouseLeave={() => setHover(null)}>
      {path && world ? (
        <svg width={width} height={height} className="block overflow-visible">
          <g>
            {world.features.map((f: Feature<Geometry, { name: string }>) => {
              const d = byId.get(String(f.id));
              const fill = d ? step(d.value) : null;
              return (
                <path
                  key={String(f.id) + f.properties.name}
                  d={path(f) ?? undefined}
                  fill={fill ?? "var(--muted)"}
                  stroke="var(--card)"
                  strokeWidth={0.6}
                  className="transition-[fill-opacity] duration-150 hover:fill-opacity-80"
                  onMouseMove={(e) => {
                    const r = ref.current?.getBoundingClientRect();
                    if (!r) return;
                    setHover({ x: e.clientX - r.left, y: e.clientY - r.top, name: d?.name ?? f.properties.name, value: d?.value ?? null });
                  }}
                />
              );
            })}
          </g>
          {data
            .filter((d) => POINTS[d.code.toUpperCase()] && d.value > 0)
            .map((d) => {
              const pt = projection?.(POINTS[d.code.toUpperCase()]!);
              if (!pt) return null;
              return (
                <circle
                  key={`p-${d.code}`}
                  cx={pt[0]}
                  cy={pt[1]}
                  r={5}
                  fill={step(d.value) ?? "var(--seq-3)"}
                  stroke="var(--card)"
                  strokeWidth={2}
                  onMouseMove={(e) => {
                    const r = ref.current?.getBoundingClientRect();
                    if (!r) return;
                    setHover({ x: e.clientX - r.left, y: e.clientY - r.top, name: d.name, value: d.value });
                  }}
                />
              );
            })}
          {markers.map((m) => {
            const pt = projection?.([m.lon, m.lat]);
            if (!pt) return null;
            const color = m.status === "offline" ? "var(--destructive)" : m.status === "planned" ? "var(--muted-foreground)" : "var(--success)";
            return (
              <g key={m.id} transform={`translate(${pt[0]},${pt[1]})`}>
                {m.status !== "planned" ? <circle r={10} fill={color} opacity={0.18} className="animate-pulse" /> : null}
                <circle r={4.5} fill={color} stroke="var(--card)" strokeWidth={2} />
                <text y={-11} textAnchor="middle" className="fill-foreground text-[10.5px] font-medium" paintOrder="stroke" stroke="var(--card)" strokeWidth={3}>
                  {m.label}
                </text>
              </g>
            );
          })}
        </svg>
      ) : (
        <div className="h-full w-full animate-pulse rounded-lg bg-muted/60" />
      )}
      {hover ? (
        <div className="absolute z-10" style={{ left: Math.min(hover.x + 14, Math.max(0, width - 180)), top: Math.max(0, hover.y - 50) }}>
          <ChartTooltipBox
            heading={hover.name}
            rows={hover.value != null ? [{ key: "v", label: legendLabel ?? "", color: step(hover.value) ?? "var(--seq-3)", value: formatValue(hover.value) }] : []}
          />
        </div>
      ) : null}
      {max > 0 ? (
        <div className="absolute bottom-1 left-1 flex items-center gap-2 rounded-md bg-card/80 px-2 py-1 text-[10.5px] text-muted-foreground backdrop-blur-sm">
          <span>{legendLabel ?? "少"}</span>
          <span className="flex overflow-hidden rounded-sm">
            {SEQ.map((c) => (
              <span key={c} className="h-2 w-5" style={{ background: c }} />
            ))}
          </span>
          <span>{formatValue(max)}</span>
        </div>
      ) : null}
    </div>
  );
}
