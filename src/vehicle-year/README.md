# Vehicle Year API

API RESTful para gestionar años de vehículos.

## Endpoints

### Base URL
```
http://localhost:3000/vehicle-years
```

### 1. Crear un año de vehículo
**POST** `/vehicle-years`

**Body:**
```json
{
  "year": 2024,
  "isActive": true
}
```

**Validaciones:**
- `year`: Entero requerido, rango 1900-2100
- `isActive`: Booleano opcional, default: `true`

**Respuesta exitosa (201):**
```json
{
  "id": "123e4567-e89b-12d3-a456-426614174000",
  "year": 2024,
  "isActive": true,
  "createdAt": "2024-01-12T10:30:00.000Z",
  "updatedAt": "2024-01-12T10:30:00.000Z"
}
```

**Errores:**
- `400`: Datos inválidos
- `409`: El año ya existe

---

### 2. Listar años con paginación y filtros
**GET** `/vehicle-years`

**Query Parameters:**

| Parámetro  | Tipo    | Requerido | Default | Descripción                                      |
|------------|---------|-----------|---------|--------------------------------------------------|
| `page`     | number  | No        | 1       | Número de página (mínimo: 1)                     |
| `limit`    | number  | No        | 10      | Elementos por página (rango: 1-100)              |
| `year`     | number  | No        | -       | Filtrar por año (4 dígitos)                      |
| `operator` | string  | No        | eq      | Operador: `eq`, `gt`, `lt`, `gte`, `lte`        |
| `isActive` | boolean | No        | -       | Filtrar por estado activo                        |

**Ejemplos:**

```bash
# Listar todos los años (página 1, 10 por página)
GET /vehicle-years

# Página 2 con 20 elementos por página
GET /vehicle-years?page=2&limit=20

# Años mayor que 2010
GET /vehicle-years?year=2010&operator=gt

# Años menor o igual a 2015
GET /vehicle-years?year=2015&operator=lte

# Solo años activos
GET /vehicle-years?isActive=true

# Combinación de filtros
GET /vehicle-years?year=2000&operator=gte&isActive=true&page=1&limit=20
```

**Respuesta exitosa (200):**
```json
{
  "data": [
    {
      "id": "123e4567-e89b-12d3-a456-426614174000",
      "year": 2024,
      "isActive": true,
      "createdAt": "2024-01-12T10:30:00.000Z",
      "updatedAt": "2024-01-12T10:30:00.000Z"
    }
  ],
  "meta": {
    "page": 1,
    "limit": 10,
    "total": 128,
    "totalPages": 13,
    "hasNextPage": true,
    "hasPreviousPage": false
  }
}
```

**Errores:**
- `400`: Parámetros de consulta inválidos

---

### 3. Obtener un año por ID
**GET** `/vehicle-years/:id`

**Parámetros:**
- `id`: UUID del año

**Ejemplo:**
```bash
GET /vehicle-years/123e4567-e89b-12d3-a456-426614174000
```

**Respuesta exitosa (200):**
```json
{
  "id": "123e4567-e89b-12d3-a456-426614174000",
  "year": 2024,
  "isActive": true,
  "createdAt": "2024-01-12T10:30:00.000Z",
  "updatedAt": "2024-01-12T10:30:00.000Z"
}
```

**Errores:**
- `404`: Año no encontrado

---

### 4. Actualizar un año
**PATCH** `/vehicle-years/:id`

**Parámetros:**
- `id`: UUID del año

**Body (todos los campos opcionales):**
```json
{
  "year": 2025,
  "isActive": false
}
```

**Validaciones:**
- `year`: Entero opcional, rango 1900-2100
- `isActive`: Booleano opcional

**Ejemplo:**
```bash
PATCH /vehicle-years/123e4567-e89b-12d3-a456-426614174000
```

**Respuesta exitosa (200):**
```json
{
  "id": "123e4567-e89b-12d3-a456-426614174000",
  "year": 2025,
  "isActive": false,
  "createdAt": "2024-01-12T10:30:00.000Z",
  "updatedAt": "2024-01-12T15:45:00.000Z"
}
```

**Errores:**
- `400`: Datos inválidos
- `404`: Año no encontrado
- `409`: El nuevo año ya existe

---

### 5. Eliminar un año
**DELETE** `/vehicle-years/:id`

**Parámetros:**
- `id`: UUID del año

**Ejemplo:**
```bash
DELETE /vehicle-years/123e4567-e89b-12d3-a456-426614174000
```

**Respuesta exitosa (200):**
```json
{
  "message": "Vehicle year with ID 123e4567-e89b-12d3-a456-426614174000 has been successfully deleted"
}
```

**Errores:**
- `404`: Año no encontrado
- `400`: No se puede eliminar un año con marcas relacionadas

**Nota:** Si el año tiene marcas relacionadas, en lugar de eliminarlo, establece `isActive: false`.

---

## Operadores de Filtro

| Operador | Descripción              | Ejemplo URL                          |
|----------|--------------------------|--------------------------------------|
| `eq`     | Igual a                  | `?year=2020&operator=eq`             |
| `gt`     | Mayor que                | `?year=2020&operator=gt`             |
| `lt`     | Menor que                | `?year=2020&operator=lt`             |
| `gte`    | Mayor o igual que        | `?year=2020&operator=gte`            |
| `lte`    | Menor o igual que        | `?year=2020&operator=lte`            |

---

## Códigos de Estado HTTP

| Código | Significado                        |
|--------|------------------------------------|
| 200    | OK - Operación exitosa             |
| 201    | Created - Recurso creado           |
| 400    | Bad Request - Datos inválidos      |
| 404    | Not Found - Recurso no encontrado  |
| 409    | Conflict - Conflicto de unicidad   |

---

## Validaciones

### Año (year)
- **Tipo**: Entero
- **Rango**: 1900 - 2100
- **Formato**: 4 dígitos
- **Único**: Sí
- **Mensajes de error**:
  - "Year must be an integer"
  - "Year must be at least 1900"
  - "Year must not exceed 2100"
  - "Year 2024 already exists" (conflicto)

### Estado Activo (isActive)
- **Tipo**: Booleano
- **Default**: `true`
- **Mensaje de error**: "isActive must be a boolean value"

### Paginación
- **page**:
  - Tipo: Entero
  - Mínimo: 1
  - Default: 1
- **limit**:
  - Tipo: Entero
  - Rango: 1-100
  - Default: 10

---

## Ejemplos de uso con cURL

```bash
# Crear un año
curl -X POST http://localhost:3000/vehicle-years \
  -H "Content-Type: application/json" \
  -d '{"year": 2024, "isActive": true}'

# Listar años con filtros
curl -X GET "http://localhost:3000/vehicle-years?year=2010&operator=gt&page=1&limit=20"

# Obtener un año específico
curl -X GET http://localhost:3000/vehicle-years/123e4567-e89b-12d3-a456-426614174000

# Actualizar un año
curl -X PATCH http://localhost:3000/vehicle-years/123e4567-e89b-12d3-a456-426614174000 \
  -H "Content-Type: application/json" \
  -d '{"isActive": false}'

# Eliminar un año
curl -X DELETE http://localhost:3000/vehicle-years/123e4567-e89b-12d3-a456-426614174000
```

---

## Documentación Swagger

Accede a la documentación interactiva de Swagger:

```
http://localhost:3000/api/docs
```

Ahí podrás probar todos los endpoints directamente desde el navegador.
