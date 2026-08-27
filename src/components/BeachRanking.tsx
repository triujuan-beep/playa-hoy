"use client";

import { useMemo,useState } from "react";
import { normalizeBeachSearch,searchRankedBeaches,type RankedBeach } from "@/lib/beach-ranking";
import type { SortOption } from "@/lib/types";
import { BeachCard } from "./BeachCard";

const INITIAL_COUNT=20;

export function BeachRanking({beaches,timeLabel,canSortDistance}:{beaches:RankedBeach[];timeLabel?:string;canSortDistance:boolean}){
  const[expanded,setExpanded]=useState(false);
  const[sort,setSort]=useState<SortOption>("score");
  const[query,setQuery]=useState("");
  const normalizedQuery=normalizeBeachSearch(query);
  const explored=useMemo(()=>searchRankedBeaches(beaches,query,sort),[beaches,query,sort]);
  const searching=Boolean(normalizedQuery);
  const visible=searching||expanded?explored:beaches.slice(0,INITIAL_COUNT);
  const strictSort=sort!=="score";
  const resultCount=explored.length;

  function updateQuery(value:string){
    setQuery(value);
    if(!normalizeBeachSearch(value))setExpanded(false);
  }

  return <section aria-labelledby="ranking-title" className="min-w-0">
    <div className="mb-5 rounded-2xl border border-[#dce5e4] bg-white p-4 shadow-[0_8px_30px_rgba(12,58,74,.04)]">
      <p className="mb-3 text-xs font-extrabold uppercase tracking-[.16em] text-[#078679]">Explorar playas</p>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_220px] sm:items-end">
        <label className="block text-sm font-bold text-[#4c6b73]">
          Buscar playa o municipio
          <span className="relative mt-1 block">
            <span aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#647b86]">⌕</span>
            <input type="search" value={query} onChange={event=>updateQuery(event.target.value)} placeholder="Ej. Burriana, Marbella, La Herradura…" className="min-h-11 w-full rounded-xl border border-[#dce5e4] bg-white pl-9 pr-3 text-base outline-none placeholder:text-[#8aa0a7] focus:border-[#075b78] focus-visible:ring-2 focus-visible:ring-[#70d4c5]"/>
          </span>
        </label>
        <label className="block text-sm font-bold text-[#4c6b73]">
          Ordenar por
          <select value={sort} onChange={event=>setSort(event.target.value as SortOption)} className="mt-1 min-h-11 w-full rounded-xl border border-[#dce5e4] bg-white px-3 text-sm font-bold outline-none focus:border-[#075b78] focus-visible:ring-2 focus-visible:ring-[#70d4c5]">
            <option value="score">Recomendación</option>
            <option value="warmest">Agua</option>
            <option value="wind">Menos viento</option>
            <option value="waves">Mar tranquilo</option>
            <option value="distance" disabled={!canSortDistance}>Distancia</option>
          </select>
        </label>
      </div>
      <p className="mt-2 text-xs leading-5 text-[#647b86]">{strictSort?"Exploración ordenada estrictamente por la variable elegida; no representa necesariamente la recomendación general.":"Ordenadas por la recomendación personalizada y el conjunto de condiciones."}</p>
    </div>

    <div className="mb-4 flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-end sm:gap-3">
      <div>
        <p className="mb-1 text-xs font-extrabold uppercase tracking-[.16em] text-[#078679]">{searching?"Resultados":expanded?"Explorar todas":timeLabel?`Ranking · ${timeLabel}`:"Ranking de ahora"}</p>
        <h2 id="ranking-title" className="text-2xl font-extrabold tracking-tight">{searching?"Playas encontradas":expanded?"Todas las playas":`Mejores playas ${timeLabel?`a las ${timeLabel}`:"ahora"}`}</h2>
      </div>
      <span className="min-w-0 break-words text-sm font-bold text-[#647b86] sm:shrink-0 sm:text-right">{searching?`${resultCount} ${resultCount===1?"resultado":"resultados"} para “${query.trim()}”`:expanded?`${beaches.length} opciones`:`${Math.min(INITIAL_COUNT,beaches.length)} de ${beaches.length}`}</span>
    </div>

    {visible.length?<div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3">{visible.map((item,index)=><BeachCard key={item.beach.id} beach={item.beach} score={item.score} distance={item.distance} position={index+1} wrapTitle={searching}/>)}</div>:<div className="rounded-2xl border border-[#dce5e4] bg-white p-6 text-sm leading-6 text-[#4c6b73]">{searching?"No encontramos playas que coincidan con tu búsqueda.":"No hay playas recomendables con las condiciones previstas para este momento."}</div>}

    {!searching&&beaches.length>INITIAL_COUNT&&<button type="button" onClick={()=>setExpanded(value=>!value)} className="mt-5 min-h-12 w-full rounded-xl border border-[#b9cfcc] bg-white px-5 text-sm font-extrabold text-[#075b78] outline-none hover:bg-[#eef7f4] focus-visible:ring-2 focus-visible:ring-[#70d4c5]">{expanded?"Volver al Top 20":`Ver las ${beaches.length-INITIAL_COUNT} playas restantes`}</button>}
  </section>;
}
