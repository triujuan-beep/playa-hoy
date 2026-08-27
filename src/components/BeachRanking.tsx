"use client";

import { useMemo,useState } from "react";
import { beachMatchesSearch,sortRankedBeaches,type RankedBeach } from "@/lib/beach-ranking";
import type { SortOption } from "@/lib/types";
import { BeachCard } from "./BeachCard";

const INITIAL_COUNT=20;

export function BeachRanking({beaches,timeLabel,canSortDistance}:{beaches:RankedBeach[];timeLabel?:string;canSortDistance:boolean}){
  const[expanded,setExpanded]=useState(false);
  const[sort,setSort]=useState<SortOption>("score");
  const[query,setQuery]=useState("");
  const explored=useMemo(()=>sortRankedBeaches(beaches.filter(item=>beachMatchesSearch(item.beach,query)),sort),[beaches,query,sort]);
  const visible=expanded?explored:beaches.slice(0,INITIAL_COUNT);
  const strictSort=sort!=="score";

  return <section aria-labelledby="ranking-title" className="min-w-0">
    <div className="mb-4 flex items-end justify-between gap-3">
      <div>
        <p className="mb-1 text-xs font-extrabold uppercase tracking-[.16em] text-[#078679]">{expanded?"Explorar todas":timeLabel?`Ranking · ${timeLabel}`:"Ranking de ahora"}</p>
        <h2 id="ranking-title" className="text-2xl font-extrabold tracking-tight">{expanded?"Todas las playas":`Mejores playas ${timeLabel?`a las ${timeLabel}`:"ahora"}`}</h2>
      </div>
      <span className="shrink-0 text-sm font-bold text-[#647b86]">{expanded?explored.length:beaches.length} opciones</span>
    </div>

    {expanded&&<div className="mb-5 rounded-2xl border border-[#dce5e4] bg-white p-4 shadow-[0_8px_30px_rgba(12,58,74,.04)]">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_220px] sm:items-end">
        <label className="block text-sm font-bold text-[#4c6b73]">
          Buscar playa
          <span className="relative mt-1 block">
            <span aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#647b86]">⌕</span>
            <input type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Buscar playa..." className="min-h-11 w-full rounded-xl border border-[#dce5e4] bg-white pl-9 pr-3 text-base outline-none placeholder:text-[#8aa0a7] focus:border-[#075b78]"/>
          </span>
        </label>
        <label className="block text-sm font-bold text-[#4c6b73]">
          Ordenar por
          <select value={sort} onChange={event=>setSort(event.target.value as SortOption)} className="mt-1 min-h-11 w-full rounded-xl border border-[#dce5e4] bg-white px-3 text-sm font-bold outline-none focus:border-[#075b78]">
            <option value="score">Recomendación</option>
            <option value="warmest">Agua</option>
            <option value="wind">Menos viento</option>
            <option value="waves">Mar tranquilo</option>
            <option value="distance" disabled={!canSortDistance}>Distancia</option>
          </select>
        </label>
      </div>
      <p className="mt-2 text-xs leading-5 text-[#647b86]">{strictSort?"Exploración ordenada estrictamente por la variable elegida; no representa necesariamente la recomendación general.":"Ordenadas por la recomendación personalizada y el conjunto de condiciones."}</p>
    </div>}

    {visible.length?<div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3">{visible.map((item,index)=><BeachCard key={item.beach.id} beach={item.beach} score={item.score} distance={item.distance} position={index+1}/>)}</div>:<div className="rounded-2xl border border-[#dce5e4] bg-white p-6 text-sm leading-6 text-[#4c6b73]">{expanded&&query?"No encontramos playas que coincidan con tu búsqueda.":"No hay playas recomendables con las condiciones previstas para este momento."}</div>}

    {beaches.length>INITIAL_COUNT&&<button type="button" onClick={()=>setExpanded(value=>!value)} className="mt-5 min-h-12 w-full rounded-xl border border-[#b9cfcc] bg-white px-5 text-sm font-extrabold text-[#075b78] hover:bg-[#eef7f4]">{expanded?"Volver al Top 20":`Ver más playas (${beaches.length-INITIAL_COUNT})`}</button>}
  </section>;
}
