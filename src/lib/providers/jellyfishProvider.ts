import "server-only";
export type JellyfishResult={risk?:number;updatedAt?:string;source?:string};
export async function getJellyfishRisk():Promise<JellyfishResult|null>{return null}
