import { calculateBeachScore,getMetricConditionValue,type ScoredNumericMetric } from "./scoring";
import type { Beach } from "./types";

export type TrendDirection="improving"|"worsening"|"stable"|"unavailable";
export type TrendMetric="waterTemperature"|"windSpeed"|"waveHeight"|"rainProbability";
export const TREND_RELEVANCE=0.03;

export function getConditionTrend(metric:TrendMetric,current:number|undefined,previous:number|undefined):TrendDirection{if(current===undefined||previous===undefined)return"unavailable";const impact=getMetricConditionValue(metric as ScoredNumericMetric,current)-getMetricConditionValue(metric as ScoredNumericMetric,previous);if(impact>=TREND_RELEVANCE)return"improving";if(impact<=-TREND_RELEVANCE)return"worsening";return"stable"}

export function getOverallConditionTrend(current:Beach,previous?:Beach):TrendDirection{if(!previous)return"unavailable";const difference=calculateBeachScore(current)-calculateBeachScore(previous);if(difference>=2)return"improving";if(difference<=-2)return"worsening";return"stable"}
