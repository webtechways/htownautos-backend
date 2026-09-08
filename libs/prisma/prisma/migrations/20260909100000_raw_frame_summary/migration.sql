-- Lo decodificado, guardado junto al frame para poder verlo en el Live Feed sin
-- cruzar tablas. Se rellena tambien en los `ignored`: un evento que todavia no
-- tratamos se entiende mirando sus datos, no su nombre.
ALTER TABLE "auction_raw_frames" ADD COLUMN "summary" JSONB;
