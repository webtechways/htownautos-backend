# Database Seeds

Esta carpeta contiene todos los scripts de seed para inicializar la base de datos con datos necesarios.

## Estructura

```
prisma/seeds/
├── index.ts                      # Archivo principal que ejecuta todos los seeds
├── vehicle-years.seed.ts         # Seed para años de vehículos (1900-2027)
├── vehicle-hierarchy.seed.ts     # Seed para Make -> Model -> Trim
└── README.md                     # Este archivo
```

## Uso

### ⚠️ IMPORTANTE: Ejecución Manual

Los seeds **NO se ejecutan automáticamente** después de migraciones. Debes ejecutarlos manualmente cuando sea necesario.

### Desarrollo (TypeScript)

```bash
# Ejecutar todos los seeds
npm run seed

# Primera vez (después de crear las tablas)
npx prisma migrate dev
npm run seed
```

### Producción (JavaScript compilado)

```bash
# 1. Compilar el proyecto
npm run build

# 2. Ejecutar seeds en producción
npm run seed:prod
```

### Al iniciar la aplicación

Puedes ejecutar los seeds automáticamente al iniciar la app en producción agregando al archivo de inicio:

```typescript
// En main.ts o en un módulo de inicialización
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function bootstrap() {
  // Ejecutar seeds en primera inicialización
  if (process.env.RUN_SEEDS === 'true') {
    console.log('🌱 Running database seeds...');
    await execAsync('npm run seed:prod');
  }

  // ... resto del código de inicialización
}
```

Luego usar:
```bash
RUN_SEEDS=true npm run start:prod
```

## Crear un nuevo seed

1. Crea un nuevo archivo en `prisma/seeds/` con el formato `nombre.seed.ts`
2. Exporta una función que reciba `PrismaClient` como parámetro:

```typescript
import { PrismaClient } from '@prisma/client';

export async function seedNombreTabla(prisma: PrismaClient) {
  console.log('📦 Seeding nombre tabla...');

  // Tu lógica de seed aquí
  await prisma.nombreTabla.createMany({
    data: [
      // tus datos
    ],
    skipDuplicates: true,
  });

  console.log('✅ Nombre tabla seeded successfully');
}
```

3. Importa y ejecuta tu seed en `index.ts`:

```typescript
import { seedNombreTabla } from './nombre.seed';

// En la función main()
await seedNombreTabla(prisma);
```

## Seeds existentes

### 1. Vehicle Years (vehicle-years.seed.ts)

Puebla la tabla `vehicle_years` con años desde 1900 hasta 2027.

- **Cantidad de registros**: 128 años
- **Batch size**: 50 registros por batch
- **Skip duplicates**: Sí
- **Tiempo estimado**: ~5 segundos

### 2. Vehicle Hierarchy (vehicle-hierarchy.seed.ts)

Puebla la jerarquía completa de vehículos desde el CSV `prisma/data/autos_data.csv`:
- Year → Make → Model → Trim

- **Fuente**: CSV con ~80,000 registros
- **Tablas pobladas**:
  - `vehicle_makes` (marcas por año)
  - `vehicle_models` (modelos por marca)
  - `vehicle_trims` (versiones por modelo)
- **Skip duplicates**: Sí (usa upsert)
- **Tiempo estimado**: Depende del tamaño del CSV (~10-30 minutos)

**⚠️ Nota**: Este seed debe ejecutarse después del seed de años.

## Características

- ✅ Ejecución manual controlada
- ✅ Uso de adapters de PostgreSQL para Prisma 7
- ✅ Inserción en batches para mejor rendimiento
- ✅ Skip duplicates automático (upsert)
- ✅ Logging detallado del progreso
- ✅ Manejo de errores y cleanup de conexiones
- ✅ Modular y fácil de extender
- ✅ Soporte para producción (JavaScript compilado)

## Orden de ejecución

Los seeds deben ejecutarse en este orden:

1. `seedVehicleYears` - Crea los años base
2. `seedVehicleHierarchy` - Crea la jerarquía de vehículos

Este orden está implementado en `index.ts`.

## Notas

- Los seeds usan variables de entorno desde `.env`
- La conexión a la base de datos usa un pool de PostgreSQL
- Los seeds son idempotentes (se pueden ejecutar múltiples veces)
- Los seeds NO se ejecutan automáticamente en migraciones
- Para producción, asegúrate de compilar primero con `npm run build`
