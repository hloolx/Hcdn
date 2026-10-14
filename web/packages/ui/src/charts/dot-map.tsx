import * as React from "react";
import { cn } from "../lib/cn";
import { worldDots } from "./world-dots";

export interface DotMapNode {
  id: string;
  label: string;
  lon: number;
  lat: number;
  status: "online" | "planned";
}

export interface DotMapArc {
  from: [number, number];
  to: string; // node id
}

/**
 * Decorative dot-matrix world map (equirectangular, re-centred on `centerLon`).
 * Used on the marketing site; purely presentational.
 */
export function DotMap({
  nodes,
  arcs = [],
  centerLon = 155,
  latTop = 66,
  latBottom = -48,
  className,
  showLabels = true,
}: {
  nodes: DotMapNode[];
  arcs?: DotMapArc[];
  centerLon?: number;
  latTop?: number;
  latBottom?: number;
  className?: string;
  showLabels?: boolean;
}) {
  const uid = React.useId().replace(/:/g, "");
  const width = 360;
  const height = latTop - latBottom;
  const x = (lon: number) => ((((lon - centerLon + 540) % 360) + 360) % 360);
  const y = (lat: number) => latTop - lat;
  const dots = React.useMemo(() => worldDots().filter(([, lat]) => lat <= latTop && lat >= latBottom), [latTop, latBottom]);
  const byId = new Map(nodes.map((n) => [n.id, n]));

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={cn("h-auto w-full", className)} aria-hidden>
      <defs>
        <radialGradient id={`${uid}-fade`} cx="50%" cy="50%" r="62%">
          <stop offset="55%" stopColor="white" stopOpacity="1" />
          <stop offset="100%" stopColor="white" stopOpacity="0" />
        </radialGradient>
        <mask id={`${uid}-mask`}>
          <rect width={width} height={height} fill={`url(#${uid}-fade)`} />
        </mask>
        <linearGradient id={`${uid}-arc`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--chart-1)" stopOpacity="0" />
          <stop offset="60%" stopColor="var(--chart-1)" stopOpacity="0.55" />
          <stop offset="100%" stopColor="oklch(0.78 0.13 205)" stopOpacity="0.95" />
        </linearGradient>
        <radialGradient id={`${uid}-glow`}>
          <stop offset="0%" stopColor="oklch(0.72 0.17 245)" stopOpacity="0.55" />
          <stop offset="100%" stopColor="oklch(0.72 0.17 245)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <g mask={`url(#${uid}-mask)`}>
        {dots.map(([lon, lat], i) => (
          <circle key={i} cx={x(lon)} cy={y(lat)} r={0.42} className="fill-foreground/[0.16] dark:fill-foreground/[0.2]" />
        ))}
      </g>
      {arcs.map((a, i) => {
        const n = byId.get(a.to);
        if (!n) return null;
        const x1 = x(a.from[0]);
        const y1 = y(a.from[1]);
        const x2 = x(n.lon);
        const y2 = y(n.lat);
        const mx = (x1 + x2) / 2;
        const my = (y1 + y2) / 2 - Math.max(4, Math.hypot(x2 - x1, y2 - y1) * 0.28);
        const d = `M${x1},${y1} Q${mx},${my} ${x2},${y2}`;
        return (
          <g key={i}>
            <path d={d} fill="none" stroke={`url(#${uid}-arc)`} strokeWidth={0.35} opacity={0.7} />
            <path
              d={d}
              fill="none"
              stroke="oklch(0.85 0.1 220)"
              strokeWidth={0.6}
              strokeLinecap="round"
              strokeDasharray="1.2 38.8"
              className="animate-dash"
              style={{ animationDelay: `${(i * -0.37) % 2.8}s`, animationDuration: `${2.4 + (i % 3) * 0.5}s` }}
            />
            <circle cx={x1} cy={y1} r={0.55} className="fill-primary/70" />
          </g>
        );
      })}
      {nodes.map((n) => {
        const cx = x(n.lon);
        const cy = y(n.lat);
        const online = n.status === "online";
        return (
          <g key={n.id}>
            {online ? (
              <>
                <circle cx={cx} cy={cy} r={6} fill={`url(#${uid}-glow)`} />
                <circle cx={cx} cy={cy} r={1.4} className="origin-center fill-primary/40 animate-pulse-ring [transform-box:fill-box]" />
              </>
            ) : null}
            <circle
              cx={cx}
              cy={cy}
              r={online ? 1.25 : 0.95}
              className={online ? "fill-primary" : "fill-muted-foreground/50"}
              stroke="var(--background)"
              strokeWidth={0.45}
            />
            {showLabels ? (
              <text
                x={cx}
                y={cy - 2.6}
                textAnchor="middle"
                className={cn("text-[2.6px] font-medium", online ? "fill-foreground" : "fill-muted-foreground")}
                paintOrder="stroke"
                stroke="var(--background)"
                strokeWidth={0.8}
              >
                {n.label}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
