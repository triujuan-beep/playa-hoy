"use client";

import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { DotItemDotProps } from "recharts";
import { formatWaterTemperature, WATER_COMFORT, waterComfort, type WaterTemperaturePoint } from "@/lib/water-temperature";

const dayLabel = (date: string) => new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));

export function WaterTemperatureChart({ points }: { points: WaterTemperaturePoint[] }) {
  const data = points.map((point) => ({ ...point, label: dayLabel(point.date) }));
  const values = points.flatMap((point) => point.value === null ? [] : [point.value]);
  const minimum = values.length ? Math.floor(Math.min(...values, 17) - 1) : 16;
  const maximum = values.length ? Math.ceil(Math.max(...values, 24) + 1) : 26;
  return <div className="h-72 w-full" aria-label="Gráfico de temperatura del agua de los últimos 14 días">
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 12, right: 8, left: -18, bottom: 0 }}>
        <defs><linearGradient id="waterTemperatureFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#16a394" stopOpacity={0.32}/><stop offset="100%" stopColor="#16a394" stopOpacity={0.03}/></linearGradient></defs>
        <CartesianGrid stroke="#e4ebe8" strokeDasharray="3 4" vertical={false}/>
        <XAxis dataKey="label" tick={{ fill: "#647b86", fontSize: 11 }} tickLine={false} axisLine={false} interval="preserveStartEnd"/>
        <YAxis domain={[minimum, maximum]} tick={{ fill: "#647b86", fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(value) => `${value}°`}/>
        <ReferenceLine y={WATER_COMFORT.cold} stroke="#6aa7c7" strokeDasharray="5 4" label={{ value: `${WATER_COMFORT.cold}°`, fill: "#647b86", fontSize: 10, position: "insideTopLeft" }}/>
        <ReferenceLine y={WATER_COMFORT.veryPleasant} stroke="#e0a24b" strokeDasharray="5 4" label={{ value: `${WATER_COMFORT.veryPleasant}°`, fill: "#647b86", fontSize: 10, position: "insideTopLeft" }}/>
        <Tooltip cursor={{ stroke: "#078679", strokeDasharray: "3 3" }} formatter={(value) => { const temperature = typeof value === "number" ? value : null; return [`${formatWaterTemperature(temperature)} · ${waterComfort(temperature)}`, "Agua"]; }} labelFormatter={(label) => String(label)}/>
        <Area type="monotone" dataKey="value" stroke="#078679" strokeWidth={3} fill="url(#waterTemperatureFill)" connectNulls={false} dot={(props: DotItemDotProps) => <circle cx={props.cx} cy={props.cy} r={props.index === data.length - 1 ? 6 : 3} fill={props.index === data.length - 1 ? "#075b78" : "#fff"} stroke="#078679" strokeWidth={props.index === data.length - 1 ? 3 : 2}/>} activeDot={{ r: 7 }}/>
      </AreaChart>
    </ResponsiveContainer>
  </div>;
}
