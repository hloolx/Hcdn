import * as React from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartTooltipBox, seriesColor, type SeriesDef } from "./chart-kit";

export interface TimeSeriesProps {
  data: Record<string, number>[];
  /** Name of the x field (unix seconds or ms). */
  x?: string;
  series: SeriesDef[];
  kind?: "area" | "line" | "bar";
  stacked?: boolean;
  height?: number;
  formatValue?: (v: number) => string;
  formatAxisValue?: (v: number) => string;
  formatTime?: (t: number) => string;
  formatTooltipTime?: (t: number) => string;
}

const axisTick = { fontSize: 11, fill: "var(--chart-axis)" } as const;

function defaultTime(t: number) {
  const d = new Date(t < 1e12 ? t * 1000 : t);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function compact(v: number) {
  const a = Math.abs(v);
  if (a >= 1e9) return `${+(v / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${+(v / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${+(v / 1e3).toFixed(1)}K`;
  return String(Math.round(v * 100) / 100);
}

/**
 * Change-over-time chart (area, line or column). One y-axis only; for two
 * measures of different scale render two charts.
 */
export function TimeSeriesChart({
  data,
  x = "t",
  series,
  kind = "area",
  stacked = false,
  height = 260,
  formatValue = compact,
  formatAxisValue,
  formatTime = defaultTime,
  formatTooltipTime,
}: TimeSeriesProps) {
  const gid = React.useId().replace(/:/g, "");
  const axisFmt = formatAxisValue ?? formatValue;

  const tooltip = (
    <Tooltip
      cursor={kind === "bar" ? { fill: "var(--muted)", opacity: 0.6 } : { stroke: "var(--chart-baseline)", strokeWidth: 1 }}
      isAnimationActive={false}
      content={({ active, payload, label }) => {
        if (!active || !payload || payload.length === 0) return null;
        const rows = series.map((s, i) => {
          const p = payload.find((pp) => pp.dataKey === s.key);
          const v = typeof p?.value === "number" ? p.value : Number(p?.value ?? 0);
          return { key: s.key, label: s.label, color: seriesColor(series, i), value: formatValue(v) };
        });
        const t = typeof label === "number" ? label : Number(label);
        return <ChartTooltipBox heading={(formatTooltipTime ?? formatTime)(t)} rows={rows} />;
      }}
    />
  );

  const common = {
    data,
    margin: { top: 8, right: 12, bottom: 0, left: 4 },
  };

  const axes = (
    <>
      <CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeWidth={1} />
      <XAxis
        dataKey={x}
        tickLine={false}
        axisLine={{ stroke: "var(--chart-baseline)" }}
        tick={axisTick}
        tickFormatter={(t: number) => formatTime(t)}
        minTickGap={28}
        tickMargin={8}
      />
      <YAxis
        tickLine={false}
        axisLine={false}
        tick={axisTick}
        tickFormatter={(v: number) => axisFmt(v)}
        width={56}
        tickMargin={4}
        allowDecimals={false}
      />
    </>
  );

  let chart: React.ReactElement;
  if (kind === "bar") {
    chart = (
      <BarChart {...common} barCategoryGap="22%">
        {axes}
        {tooltip}
        {series.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.label}
            fill={seriesColor(series, i)}
            stackId={stacked ? "s" : undefined}
            maxBarSize={24}
            radius={stacked && i < series.length - 1 ? [0, 0, 0, 0] : [4, 4, 0, 0]}
            stroke={stacked ? "var(--card)" : undefined}
            strokeWidth={stacked ? 2 : 0}
            isAnimationActive={false}
          />
        ))}
      </BarChart>
    );
  } else if (kind === "line") {
    chart = (
      <LineChart {...common}>
        {axes}
        {tooltip}
        {series.map((s, i) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={seriesColor(series, i)}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            dot={false}
            activeDot={{ r: 4.5, strokeWidth: 2, stroke: "var(--card)" }}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    );
  } else {
    chart = (
      <AreaChart {...common}>
        <defs>
          {series.map((s, i) => (
            <linearGradient key={s.key} id={`${gid}-${i}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={seriesColor(series, i)} stopOpacity={0.16} />
              <stop offset="100%" stopColor={seriesColor(series, i)} stopOpacity={0.01} />
            </linearGradient>
          ))}
        </defs>
        {axes}
        {tooltip}
        {series.map((s, i) => (
          <Area
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stackId={stacked ? "s" : undefined}
            stroke={seriesColor(series, i)}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill={`url(#${gid}-${i})`}
            dot={false}
            activeDot={{ r: 4.5, strokeWidth: 2, stroke: "var(--card)" }}
            isAnimationActive={false}
          />
        ))}
      </AreaChart>
    );
  }

  return (
    <div style={{ height }} className="w-full min-w-0 [&_.recharts-surface]:overflow-visible">
      <ResponsiveContainer width="100%" height="100%">
        {chart}
      </ResponsiveContainer>
    </div>
  );
}
