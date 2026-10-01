import { VehicleHistoryAdapter } from '../types';
import { cheapCarfaxAdapter } from './cheapcarfax.adapter';
import { globalVinAdapter } from './globalvin.adapter';

/** Every provider the router knows. New ones join the end of the fallback order. */
export const ADAPTERS: VehicleHistoryAdapter[] = [cheapCarfaxAdapter, globalVinAdapter];

export const ADAPTER_BY_KEY = new Map(ADAPTERS.map((a) => [a.key, a]));
