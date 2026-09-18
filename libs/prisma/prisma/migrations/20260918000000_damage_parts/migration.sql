-- Daños por pieza vistos por un modelo de visión.
--
-- El catálogo se siembra AQUÍ y no en un script aparte a propósito: es la fuente
-- de verdad de qué campos existen en el vector de entrenamiento, así que tiene
-- que viajar con el esquema. Un catálogo que se siembra a mano acaba distinto en
-- cada entorno, y entonces las features de desarrollo dejan de ser las de
-- producción sin que nada falle.
--
-- `orden` fija la posición de cada pieza en ese vector y no se reordena nunca.

CREATE TYPE "DamagePartGroup" AS ENUM ('exterior', 'interior');
CREATE TYPE "VehicleSide" AS ENUM ('left', 'right');
CREATE TYPE "VehicleDamageType" AS ENUM ('dent', 'scratch', 'crack', 'missing', 'broken',
  'paint_damage', 'misalignment', 'burn', 'water_damage', 'deployed');
CREATE TYPE "VehicleRepairAction" AS ENUM ('repair', 'replace', 'inspect');

CREATE TABLE "damage_parts" (
  "code"       TEXT NOT NULL,
  "grupo"      "DamagePartGroup" NOT NULL,
  "subgrupo"   TEXT NOT NULL,
  "lado"       "VehicleSide",
  "soloPickup" BOOLEAN NOT NULL DEFAULT false,
  "orden"      INTEGER NOT NULL,
  "activo"     BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "damage_parts_pkey" PRIMARY KEY ("code")
);
CREATE UNIQUE INDEX "damage_parts_orden_key" ON "damage_parts"("orden");
CREATE INDEX "damage_parts_grupo_subgrupo_idx" ON "damage_parts"("grupo", "subgrupo");

CREATE TABLE "lot_damage_analyses" (
  "id"               TEXT NOT NULL,
  "lotNumber"        BIGINT NOT NULL,
  "modelo"           TEXT NOT NULL,
  "promptVersion"    TEXT NOT NULL,
  "fotosVistas"      INTEGER NOT NULL DEFAULT 0,
  "secuenciasVistas" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
  "zonasCubiertas"   TEXT[] DEFAULT ARRAY[]::TEXT[],
  "status"           TEXT NOT NULL DEFAULT 'done',
  "error"            TEXT,
  "tokensEntrada"    INTEGER,
  "tokensSalida"     INTEGER,
  "costeUsd"         DECIMAL(10,6),
  "duracionMs"       INTEGER,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "lot_damage_analyses_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "lot_damage_analyses_lotNumber_createdAt_idx" ON "lot_damage_analyses"("lotNumber", "createdAt");
CREATE INDEX "lot_damage_analyses_modelo_createdAt_idx" ON "lot_damage_analyses"("modelo", "createdAt");

CREATE TABLE "lot_part_damages" (
  "analysisId"   TEXT NOT NULL,
  "partCode"     TEXT NOT NULL,
  "lotNumber"    BIGINT NOT NULL,
  "damageTypes"  "VehicleDamageType"[] DEFAULT ARRAY[]::"VehicleDamageType"[],
  "severity"     INTEGER,
  "repairAction" "VehicleRepairAction",
  "confidence"   INTEGER,
  "nota"         TEXT,
  CONSTRAINT "lot_part_damages_pkey" PRIMARY KEY ("analysisId", "partCode")
);
CREATE INDEX "lot_part_damages_lotNumber_idx" ON "lot_part_damages"("lotNumber");
CREATE INDEX "lot_part_damages_partCode_idx" ON "lot_part_damages"("partCode");

ALTER TABLE "lot_damage_analyses" ADD CONSTRAINT "lot_damage_analyses_lotNumber_fkey"
  FOREIGN KEY ("lotNumber") REFERENCES "auction_listings"("lotNumber") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lot_part_damages" ADD CONSTRAINT "lot_part_damages_analysisId_fkey"
  FOREIGN KEY ("analysisId") REFERENCES "lot_damage_analyses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lot_part_damages" ADD CONSTRAINT "lot_part_damages_partCode_fkey"
  FOREIGN KEY ("partCode") REFERENCES "damage_parts"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── El catálogo: 180 piezas ──
INSERT INTO "damage_parts" ("code", "grupo", "subgrupo", "lado", "soloPickup", "orden") VALUES
  ('front_bumper_cover', 'exterior', 'front_end', NULL::"VehicleSide", false, 1),
  ('front_bumper_reinforcement', 'exterior', 'front_end', NULL::"VehicleSide", false, 2),
  ('front_bumper_brackets', 'exterior', 'front_end', NULL::"VehicleSide", false, 3),
  ('front_grille', 'exterior', 'front_end', NULL::"VehicleSide", false, 4),
  ('upper_grille', 'exterior', 'front_end', NULL::"VehicleSide", false, 5),
  ('lower_grille', 'exterior', 'front_end', NULL::"VehicleSide", false, 6),
  ('hood', 'exterior', 'front_end', NULL::"VehicleSide", false, 7),
  ('hood_latch', 'exterior', 'front_end', NULL::"VehicleSide", false, 8),
  ('hood_hinges', 'exterior', 'front_end', NULL::"VehicleSide", false, 9),
  ('hood_insulation', 'exterior', 'front_end', NULL::"VehicleSide", false, 10),
  ('hood_emblem', 'exterior', 'front_end', NULL::"VehicleSide", false, 11),
  ('left_headlight', 'exterior', 'front_end', 'left'::"VehicleSide", false, 12),
  ('right_headlight', 'exterior', 'front_end', 'right'::"VehicleSide", false, 13),
  ('left_fog_light', 'exterior', 'front_end', 'left'::"VehicleSide", false, 14),
  ('right_fog_light', 'exterior', 'front_end', 'right'::"VehicleSide", false, 15),
  ('daytime_running_light', 'exterior', 'front_end', NULL::"VehicleSide", false, 16),
  ('front_camera', 'exterior', 'front_end', NULL::"VehicleSide", false, 17),
  ('front_radar_sensor', 'exterior', 'front_end', NULL::"VehicleSide", false, 18),
  ('parking_sensors', 'exterior', 'front_end', NULL::"VehicleSide", false, 19),
  ('radiator_support', 'exterior', 'front_end', NULL::"VehicleSide", false, 20),
  ('upper_tie_bar', 'exterior', 'front_end', NULL::"VehicleSide", false, 21),
  ('lower_tie_bar', 'exterior', 'front_end', NULL::"VehicleSide", false, 22),
  ('radiator', 'exterior', 'front_end', NULL::"VehicleSide", false, 23),
  ('condenser', 'exterior', 'front_end', NULL::"VehicleSide", false, 24),
  ('cooling_fan', 'exterior', 'front_end', NULL::"VehicleSide", false, 25),
  ('air_intake', 'exterior', 'front_end', NULL::"VehicleSide", false, 26),
  ('front_crash_bar', 'exterior', 'front_end', NULL::"VehicleSide", false, 27),
  ('left_front_fender', 'exterior', 'side_body_left', 'left'::"VehicleSide", false, 28),
  ('left_rear_quarter_panel', 'exterior', 'side_body_left', 'left'::"VehicleSide", false, 29),
  ('left_front_door', 'exterior', 'side_body_left', 'left'::"VehicleSide", false, 30),
  ('left_rear_door', 'exterior', 'side_body_left', 'left'::"VehicleSide", false, 31),
  ('left_door_handle_front', 'exterior', 'side_body_left', 'left'::"VehicleSide", false, 32),
  ('left_door_handle_rear', 'exterior', 'side_body_left', 'left'::"VehicleSide", false, 33),
  ('left_side_mirror', 'exterior', 'side_body_left', 'left'::"VehicleSide", false, 34),
  ('left_mirror_cap', 'exterior', 'side_body_left', 'left'::"VehicleSide", false, 35),
  ('left_window_front', 'exterior', 'side_body_left', 'left'::"VehicleSide", false, 36),
  ('left_window_rear', 'exterior', 'side_body_left', 'left'::"VehicleSide", false, 37),
  ('left_door_glass', 'exterior', 'side_body_left', 'left'::"VehicleSide", false, 38),
  ('left_b_pillar', 'exterior', 'side_body_left', 'left'::"VehicleSide", false, 39),
  ('left_a_pillar', 'exterior', 'side_body_left', 'left'::"VehicleSide", false, 40),
  ('left_c_pillar', 'exterior', 'side_body_left', 'left'::"VehicleSide", false, 41),
  ('left_rocker_panel', 'exterior', 'side_body_left', 'left'::"VehicleSide", false, 42),
  ('left_side_skirt', 'exterior', 'side_body_left', 'left'::"VehicleSide", false, 43),
  ('left_running_board', 'exterior', 'side_body_left', 'left'::"VehicleSide", false, 44),
  ('left_wheel_arch', 'exterior', 'side_body_left', 'left'::"VehicleSide", false, 45),
  ('left_fender_flare', 'exterior', 'side_body_left', 'left'::"VehicleSide", false, 46),
  ('right_front_fender', 'exterior', 'side_body_right', 'right'::"VehicleSide", false, 47),
  ('right_rear_quarter_panel', 'exterior', 'side_body_right', 'right'::"VehicleSide", false, 48),
  ('right_front_door', 'exterior', 'side_body_right', 'right'::"VehicleSide", false, 49),
  ('right_rear_door', 'exterior', 'side_body_right', 'right'::"VehicleSide", false, 50),
  ('right_door_handle_front', 'exterior', 'side_body_right', 'right'::"VehicleSide", false, 51),
  ('right_door_handle_rear', 'exterior', 'side_body_right', 'right'::"VehicleSide", false, 52),
  ('right_side_mirror', 'exterior', 'side_body_right', 'right'::"VehicleSide", false, 53),
  ('right_mirror_cap', 'exterior', 'side_body_right', 'right'::"VehicleSide", false, 54),
  ('right_window_front', 'exterior', 'side_body_right', 'right'::"VehicleSide", false, 55),
  ('right_window_rear', 'exterior', 'side_body_right', 'right'::"VehicleSide", false, 56),
  ('right_door_glass', 'exterior', 'side_body_right', 'right'::"VehicleSide", false, 57),
  ('right_b_pillar', 'exterior', 'side_body_right', 'right'::"VehicleSide", false, 58),
  ('right_a_pillar', 'exterior', 'side_body_right', 'right'::"VehicleSide", false, 59),
  ('right_c_pillar', 'exterior', 'side_body_right', 'right'::"VehicleSide", false, 60),
  ('right_rocker_panel', 'exterior', 'side_body_right', 'right'::"VehicleSide", false, 61),
  ('right_side_skirt', 'exterior', 'side_body_right', 'right'::"VehicleSide", false, 62),
  ('right_running_board', 'exterior', 'side_body_right', 'right'::"VehicleSide", false, 63),
  ('right_wheel_arch', 'exterior', 'side_body_right', 'right'::"VehicleSide", false, 64),
  ('right_fender_flare', 'exterior', 'side_body_right', 'right'::"VehicleSide", false, 65),
  ('rear_bumper_cover', 'exterior', 'rear_end', NULL::"VehicleSide", false, 66),
  ('rear_bumper_reinforcement', 'exterior', 'rear_end', NULL::"VehicleSide", false, 67),
  ('rear_bumper_brackets', 'exterior', 'rear_end', NULL::"VehicleSide", false, 68),
  ('rear_tailgate', 'exterior', 'rear_end', NULL::"VehicleSide", false, 69),
  ('tailgate_handle', 'exterior', 'rear_end', NULL::"VehicleSide", false, 70),
  ('tailgate_camera', 'exterior', 'rear_end', NULL::"VehicleSide", false, 71),
  ('tailgate_lock', 'exterior', 'rear_end', NULL::"VehicleSide", false, 72),
  ('rear_hatch', 'exterior', 'rear_end', NULL::"VehicleSide", false, 73),
  ('rear_window', 'exterior', 'rear_end', NULL::"VehicleSide", false, 74),
  ('rear_spoiler', 'exterior', 'rear_end', NULL::"VehicleSide", false, 75),
  ('left_tail_light', 'exterior', 'rear_end', 'left'::"VehicleSide", false, 76),
  ('right_tail_light', 'exterior', 'rear_end', 'right'::"VehicleSide", false, 77),
  ('third_brake_light', 'exterior', 'rear_end', NULL::"VehicleSide", false, 78),
  ('rear_emblem', 'exterior', 'rear_end', NULL::"VehicleSide", false, 79),
  ('license_plate_area', 'exterior', 'rear_end', NULL::"VehicleSide", false, 80),
  ('rear_fog_light', 'exterior', 'rear_end', NULL::"VehicleSide", false, 81),
  ('tow_hitch', 'exterior', 'rear_end', NULL::"VehicleSide", false, 82),
  ('roof_panel', 'exterior', 'roof', NULL::"VehicleSide", false, 83),
  ('roof_rails', 'exterior', 'roof', NULL::"VehicleSide", false, 84),
  ('sunroof', 'exterior', 'roof', NULL::"VehicleSide", false, 85),
  ('moonroof_glass', 'exterior', 'roof', NULL::"VehicleSide", false, 86),
  ('sunroof_frame', 'exterior', 'roof', NULL::"VehicleSide", false, 87),
  ('antenna', 'exterior', 'roof', NULL::"VehicleSide", false, 88),
  ('roof_molding', 'exterior', 'roof', NULL::"VehicleSide", false, 89),
  ('windshield', 'exterior', 'glass', NULL::"VehicleSide", false, 90),
  ('front_left_window', 'exterior', 'glass', 'left'::"VehicleSide", false, 91),
  ('front_right_window', 'exterior', 'glass', 'right'::"VehicleSide", false, 92),
  ('rear_left_window', 'exterior', 'glass', 'left'::"VehicleSide", false, 93),
  ('rear_right_window', 'exterior', 'glass', 'right'::"VehicleSide", false, 94),
  ('quarter_glass_left', 'exterior', 'glass', 'left'::"VehicleSide", false, 95),
  ('quarter_glass_right', 'exterior', 'glass', 'right'::"VehicleSide", false, 96),
  ('left_front_tire', 'exterior', 'wheels_and_suspension_visible', 'left'::"VehicleSide", false, 97),
  ('right_front_tire', 'exterior', 'wheels_and_suspension_visible', 'right'::"VehicleSide", false, 98),
  ('left_rear_tire', 'exterior', 'wheels_and_suspension_visible', 'left'::"VehicleSide", false, 99),
  ('right_rear_tire', 'exterior', 'wheels_and_suspension_visible', 'right'::"VehicleSide", false, 100),
  ('left_front_wheel', 'exterior', 'wheels_and_suspension_visible', 'left'::"VehicleSide", false, 101),
  ('right_front_wheel', 'exterior', 'wheels_and_suspension_visible', 'right'::"VehicleSide", false, 102),
  ('left_rear_wheel', 'exterior', 'wheels_and_suspension_visible', 'left'::"VehicleSide", false, 103),
  ('right_rear_wheel', 'exterior', 'wheels_and_suspension_visible', 'right'::"VehicleSide", false, 104),
  ('wheel_rim', 'exterior', 'wheels_and_suspension_visible', NULL::"VehicleSide", false, 105),
  ('hubcap', 'exterior', 'wheels_and_suspension_visible', NULL::"VehicleSide", false, 106),
  ('brake_caliper_visible', 'exterior', 'wheels_and_suspension_visible', NULL::"VehicleSide", false, 107),
  ('mud_flap', 'exterior', 'wheels_and_suspension_visible', NULL::"VehicleSide", false, 108),
  ('bed', 'exterior', 'truck_specific', NULL::"VehicleSide", true, 109),
  ('bed_side_left', 'exterior', 'truck_specific', 'left'::"VehicleSide", true, 110),
  ('bed_side_right', 'exterior', 'truck_specific', 'right'::"VehicleSide", true, 111),
  ('bed_floor', 'exterior', 'truck_specific', NULL::"VehicleSide", true, 112),
  ('tailgate', 'exterior', 'truck_specific', NULL::"VehicleSide", true, 113),
  ('tonneau_cover', 'exterior', 'truck_specific', NULL::"VehicleSide", true, 114),
  ('bedliner', 'exterior', 'truck_specific', NULL::"VehicleSide", true, 115),
  ('toolbox', 'exterior', 'truck_specific', NULL::"VehicleSide", true, 116),
  ('dashboard_top', 'interior', 'dashboard', NULL::"VehicleSide", false, 117),
  ('dashboard_lower', 'interior', 'dashboard', NULL::"VehicleSide", false, 118),
  ('instrument_cluster', 'interior', 'dashboard', NULL::"VehicleSide", false, 119),
  ('speedometer', 'interior', 'dashboard', NULL::"VehicleSide", false, 120),
  ('tachometer', 'interior', 'dashboard', NULL::"VehicleSide", false, 121),
  ('center_console', 'interior', 'dashboard', NULL::"VehicleSide", false, 122),
  ('infotainment_screen', 'interior', 'dashboard', NULL::"VehicleSide", false, 123),
  ('radio', 'interior', 'dashboard', NULL::"VehicleSide", false, 124),
  ('climate_controls', 'interior', 'dashboard', NULL::"VehicleSide", false, 125),
  ('air_vents', 'interior', 'dashboard', NULL::"VehicleSide", false, 126),
  ('glove_box', 'interior', 'dashboard', NULL::"VehicleSide", false, 127),
  ('steering_column', 'interior', 'dashboard', NULL::"VehicleSide", false, 128),
  ('steering_wheel', 'interior', 'driver_area', NULL::"VehicleSide", false, 129),
  ('steering_wheel_airbag_cover', 'interior', 'driver_area', NULL::"VehicleSide", false, 130),
  ('driver_seat', 'interior', 'driver_area', 'left'::"VehicleSide", false, 131),
  ('driver_seat_headrest', 'interior', 'driver_area', 'left'::"VehicleSide", false, 132),
  ('driver_seat_backrest', 'interior', 'driver_area', 'left'::"VehicleSide", false, 133),
  ('driver_seat_cushion', 'interior', 'driver_area', 'left'::"VehicleSide", false, 134),
  ('driver_floor', 'interior', 'driver_area', 'left'::"VehicleSide", false, 135),
  ('pedals', 'interior', 'driver_area', NULL::"VehicleSide", false, 136),
  ('parking_brake', 'interior', 'driver_area', NULL::"VehicleSide", false, 137),
  ('gear_selector', 'interior', 'driver_area', NULL::"VehicleSide", false, 138),
  ('passenger_seat', 'interior', 'passenger_area', 'right'::"VehicleSide", false, 139),
  ('passenger_headrest', 'interior', 'passenger_area', 'right'::"VehicleSide", false, 140),
  ('passenger_dashboard', 'interior', 'passenger_area', 'right'::"VehicleSide", false, 141),
  ('passenger_floor', 'interior', 'passenger_area', 'right'::"VehicleSide", false, 142),
  ('door_panel_passenger', 'interior', 'passenger_area', NULL::"VehicleSide", false, 143),
  ('rear_seats', 'interior', 'rear_cabin', NULL::"VehicleSide", false, 144),
  ('rear_seat_backrest', 'interior', 'rear_cabin', NULL::"VehicleSide", false, 145),
  ('rear_seat_cushion', 'interior', 'rear_cabin', NULL::"VehicleSide", false, 146),
  ('rear_headrests', 'interior', 'rear_cabin', NULL::"VehicleSide", false, 147),
  ('rear_floor', 'interior', 'rear_cabin', NULL::"VehicleSide", false, 148),
  ('rear_center_console', 'interior', 'rear_cabin', NULL::"VehicleSide", false, 149),
  ('rear_air_vents', 'interior', 'rear_cabin', NULL::"VehicleSide", false, 150),
  ('left_front_door_panel', 'interior', 'doors_interior', 'left'::"VehicleSide", false, 151),
  ('right_front_door_panel', 'interior', 'doors_interior', 'right'::"VehicleSide", false, 152),
  ('left_rear_door_panel', 'interior', 'doors_interior', 'left'::"VehicleSide", false, 153),
  ('right_rear_door_panel', 'interior', 'doors_interior', 'right'::"VehicleSide", false, 154),
  ('door_trim', 'interior', 'doors_interior', NULL::"VehicleSide", false, 155),
  ('door_armrest', 'interior', 'doors_interior', NULL::"VehicleSide", false, 156),
  ('window_switches', 'interior', 'doors_interior', NULL::"VehicleSide", false, 157),
  ('door_handle_inside', 'interior', 'doors_interior', NULL::"VehicleSide", false, 158),
  ('driver_airbag', 'interior', 'safety', 'left'::"VehicleSide", false, 159),
  ('passenger_airbag', 'interior', 'safety', 'right'::"VehicleSide", false, 160),
  ('side_airbag', 'interior', 'safety', NULL::"VehicleSide", false, 161),
  ('curtain_airbag', 'interior', 'safety', NULL::"VehicleSide", false, 162),
  ('seat_belts', 'interior', 'safety', NULL::"VehicleSide", false, 163),
  ('airbag_deployed_indicator', 'interior', 'safety', NULL::"VehicleSide", false, 164),
  ('srs_warning_light', 'interior', 'safety', NULL::"VehicleSide", false, 165),
  ('headliner', 'interior', 'roof_interior', NULL::"VehicleSide", false, 166),
  ('sun_visors', 'interior', 'roof_interior', NULL::"VehicleSide", false, 167),
  ('overhead_console', 'interior', 'roof_interior', NULL::"VehicleSide", false, 168),
  ('dome_light', 'interior', 'roof_interior', NULL::"VehicleSide", false, 169),
  ('grab_handles', 'interior', 'roof_interior', NULL::"VehicleSide", false, 170),
  ('backup_camera_display', 'interior', 'electronics', NULL::"VehicleSide", false, 171),
  ('navigation_system', 'interior', 'electronics', NULL::"VehicleSide", false, 172),
  ('usb_ports', 'interior', 'electronics', NULL::"VehicleSide", false, 173),
  ('wireless_charger', 'interior', 'electronics', NULL::"VehicleSide", false, 174),
  ('speakers', 'interior', 'electronics', NULL::"VehicleSide", false, 175),
  ('digital_cluster', 'interior', 'electronics', NULL::"VehicleSide", false, 176),
  ('trunk_floor', 'interior', 'cargo', NULL::"VehicleSide", false, 177),
  ('trunk_side_panels', 'interior', 'cargo', NULL::"VehicleSide", false, 178),
  ('spare_tire_area', 'interior', 'cargo', NULL::"VehicleSide", false, 179),
  ('cargo_cover', 'interior', 'cargo', NULL::"VehicleSide", false, 180)
ON CONFLICT ("code") DO NOTHING;

-- ── El vector completo, con los huecos dentro ──
--
-- Aquí es donde se cumple "los campos tienen que estar". No se guardan las
-- piezas sanas, pero esta vista las devuelve igualmente: el CROSS JOIN contra el
-- catálogo obliga a que aparezcan las 180, y el LEFT JOIN deja en NULL las que
-- el modelo no reportó. Una fila por (análisis, pieza), siempre 180 por análisis,
-- siempre en el mismo orden.
--
-- Añadir una pieza al catálogo la hace aparecer aquí sola, sin tocar esta vista
-- ni ninguna tabla.
CREATE VIEW "lot_part_matrix" AS
SELECT
  a."lotNumber",
  a."id"        AS "analysisId",
  a."modelo",
  a."status",
  p."code"      AS "partCode",
  p."orden",
  p."grupo",
  p."subgrupo",
  -- Distingue "sana" de "no se pudo ver": sin esto el modelo de precio
  -- aprendería que la ausencia de foto significa ausencia de daño.
  (p."subgrupo" = ANY(a."zonasCubiertas")) AS "zonaCubierta",
  d."damageTypes",
  d."severity",
  d."repairAction",
  d."confidence",
  (d."partCode" IS NOT NULL) AS "danada"
FROM "lot_damage_analyses" a
CROSS JOIN "damage_parts" p
LEFT JOIN "lot_part_damages" d
       ON d."analysisId" = a."id" AND d."partCode" = p."code"
WHERE p."activo";

-- ── La misma información en forma de fila, lista para entrenar ──
--
-- Devuelve un array de 180 posiciones por lote, ordenado por `orden`. La
-- posición N es siempre la misma pieza, en esta ejecución y en la de dentro de
-- un año, porque `orden` es inmutable. Eso es lo que permite que un modelo
-- entrenado hoy siga leyendo bien las features de mañana.
CREATE VIEW "lot_damage_features" AS
SELECT
  m."lotNumber",
  m."analysisId",
  m."modelo",
  array_agg(m."severity"    ORDER BY m."orden") AS "severityVector",
  array_agg(m."confidence"  ORDER BY m."orden") AS "confidenceVector",
  array_agg(m."danada"      ORDER BY m."orden") AS "danadaVector",
  array_agg(m."zonaCubierta" ORDER BY m."orden") AS "cubiertaVector",
  count(*) FILTER (WHERE m."danada")                       AS "piezasDanadas",
  count(*) FILTER (WHERE m."danada" AND m."severity" >= 7) AS "piezasGraves",
  coalesce(sum(m."severity"), 0)                           AS "severidadTotal",
  max(m."severity")                                        AS "severidadMaxima"
FROM "lot_part_matrix" m
GROUP BY m."lotNumber", m."analysisId", m."modelo";
