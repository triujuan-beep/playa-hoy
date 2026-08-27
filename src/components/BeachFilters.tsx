import type { Priority } from "@/lib/types";

const priorities:{key:Priority;icon:string;label:string;requiresJellyfish?:boolean}[]=[
  {key:"warmWater",icon:"°",label:"Agua caliente"},
  {key:"lowWind",icon:"↝",label:"Poco viento"},
  {key:"calmSea",icon:"≈",label:"Mar tranquilo"},
  {key:"lowJellyfish",icon:"🪼",label:"Evitar avistamientos",requiresJellyfish:true},
];

export function BeachFilters({selected,onToggle,jellyfishAvailable}:{selected:Priority[];onToggle:(priority:Priority)=>void;jellyfishAvailable:boolean}){
  return <section aria-labelledby="filters-title" className="rounded-3xl border border-[#dce5e4] bg-white p-4 shadow-[0_8px_30px_rgba(12,58,74,.05)] sm:p-5">
    <div className="mb-4 flex items-start justify-between gap-3">
      <div>
        <p className="mb-1 text-xs font-extrabold uppercase tracking-[.16em] text-[#078679]">Personaliza</p>
        <h2 id="filters-title" className="text-lg font-extrabold">Lo que más me importa</h2>
        <p className="mt-1 max-w-2xl text-xs leading-5 text-[#647b86] sm:text-sm">Da más importancia a tu preferencia sin dejar de valorar el resto de condiciones.</p>
      </div>
      {selected.length>0&&<span className="shrink-0 text-xs font-bold text-[#075b78]">{selected.length} activados</span>}
    </div>
    <div className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-4 sm:px-0">
      {priorities.map(item=>{const active=selected.includes(item.key);const disabled=Boolean(item.requiresJellyfish&&!jellyfishAvailable);return <button key={item.key} type="button" disabled={disabled} onClick={()=>onToggle(item.key)} aria-pressed={active} className={`flex min-h-12 shrink-0 items-center gap-2 rounded-xl border px-3 text-sm font-bold transition sm:flex-col sm:justify-center sm:gap-1 sm:py-3 ${disabled?"cursor-not-allowed border-[#dce5e4] bg-[#f4f5f1] text-[#7a8e96]":active?"border-[#075b78] bg-[#075b78] text-white shadow-md":"border-[#dce5e4] bg-[#fbfcfa] hover:border-[#70d4c5]"}`}>
        <span className={`text-lg ${active?"text-[#70d4c5]":disabled?"text-[#8da19f]":"text-[#078679]"}`}>{item.icon}</span>
        <span>{item.label}</span>
      </button>})}
    </div>
  </section>;
}
