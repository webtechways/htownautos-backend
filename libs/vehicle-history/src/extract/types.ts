/** CONTRACT `report` shape — exact keys, do not rename (frontend + v2 endpoint depend on them). */
export type DamageArea =
  | 'front'
  | 'rear'
  | 'left'
  | 'right'
  | 'front_right'
  | 'front_left'
  | 'rear_right'
  | 'rear_left'
  | 'roof'
  | 'undercarrier'
  | 'burn';

export type DamageType = 'minor' | 'moderate' | 'heavy' | null;

export type TitleBrand = 'Clean Title' | 'Rebuilt Title' | 'Salvage Title' | 'Non Reparable' | null;

export interface HistoryTableRow {
  date: string | null;
  millage: number | null;
  source: string | null;
  comment: string;
  damage_type: DamageType;
  if_damage: DamageArea[] | null;
  flooded: boolean;
  burn: boolean;
  bandalist: boolean;
  teaft: boolean;
  total_lost: boolean;
  salvage_issue: boolean;
}

export interface OwnerHistory {
  owner_no: number;
  purchased: string | null;
  type_of_owner: string | null;
  millage: number | null;
  history_table: HistoryTableRow[];
}

export interface VehicleHistoryReportExtract {
  millage: number | null;
  accident: boolean | null;
  title: TitleBrand;
  value: number | null;
  service_history_record: number | null;
  at_last_open_recall: number | null;
  last_owner_state: string | null;
  owners_history: OwnerHistory[];
}

export interface ExtractionWrapper {
  is_vehicle_history_report: boolean;
  report: VehicleHistoryReportExtract;
}
