const CARDINAL_DIRECTIONS=["N","NE","E","SE","S","SO","O","NO"] as const;

export function formatDecimal(value:number,digits:number){return new Intl.NumberFormat("es-ES",{minimumFractionDigits:digits,maximumFractionDigits:digits,useGrouping:false}).format(value)}

export function degreesToCardinal(degrees:number){const normalized=((degrees%360)+360)%360;return CARDINAL_DIRECTIONS[Math.round(normalized/45)%CARDINAL_DIRECTIONS.length]}

export function formatCardinalDegrees(degrees:number){const normalized=((degrees%360)+360)%360;return`${degreesToCardinal(normalized)} (${formatDecimal(normalized,0)}°)`}
