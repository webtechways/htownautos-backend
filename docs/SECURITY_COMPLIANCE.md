# Seguridad y Compliance - RouteOne & DealerTrack

## Resumen

Este documento describe las medidas de seguridad implementadas para cumplir con los requisitos de **RouteOne** y **DealerTrack**, dos de las plataformas más importantes en la industria automotriz.

## Certificaciones y Compliance

### ✅ RouteOne
- Auditoría completa de operaciones
- Encriptación de datos sensibles
- Rate limiting y protección DDoS
- Retención de logs por 7 años
- Validación de SSN y datos financieros

### ✅ DealerTrack
- Validación de VIN con check digit
- Headers de seguridad (Helmet)
- CORS configurado correctamente
- Input sanitization
- Prevención de inyección SQL y XSS

### ✅ GLBA (Gramm-Leach-Bliley Act)
- Protección de información financiera
- Audit trail completo
- Encriptación en reposo y tránsito

### ✅ OFAC (Office of Foreign Assets Control)
- Registro de verificaciones
- Audit logs con compliance tags

## Medidas de Seguridad Implementadas

### 1. Headers de Seguridad (Helmet)

```typescript
// Implementado en main.ts
helmet({
  contentSecurityPolicy: true,
  hsts: { maxAge: 31536000, includeSubDomains: true },
  frameguard: { action: 'deny' },
  noSniff: true,
  xssFilter: true,
})
```

**Protege contra:**
- Clickjacking
- XSS (Cross-Site Scripting)
- MIME sniffing
- Protocol downgrade attacks

### 2. Rate Limiting

```typescript
// 3 niveles de protección
- Short: 10 requests/segundo
- Medium: 100 requests/minuto
- Long: 1000 requests/hora
```

**Protege contra:**
- Ataques DDoS
- Brute force
- Scraping automatizado

### 3. CORS Configuración Segura

```typescript
origin: process.env.ALLOWED_ORIGINS?.split(',')
credentials: true
methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
```

**Beneficios:**
- Solo dominios autorizados
- Previene CSRF
- Control granular de métodos

### 4. Validación de Inputs

#### SSN Validator
```typescript
@IsValidSSN()
ssn: string; // Valida formato XXX-XX-XXXX
```

**Reglas:**
- No puede empezar con 000, 666, o 900-999
- Grupo medio no puede ser 00
- Serial no puede ser 0000

#### VIN Validator
```typescript
@IsValidVIN()
vin: string; // Valida 17 caracteres + check digit
```

**Reglas:**
- Exactamente 17 caracteres
- No contiene I, O, Q
- Validación de check digit (posición 9)

### 5. Sanitización de Datos

#### Transformers Disponibles
```typescript
@SanitizeString() // Remueve caracteres peligrosos
@NormalizeSSN()   // Formatea SSN a XXX-XX-XXXX
@NormalizeVIN()   // Mayúsculas, sin espacios
@NormalizeEmail() // Minúsculas, trim
@NormalizePhone() // Formato (XXX) XXX-XXXX
@CapitalizeName() // Primera letra mayúscula
@SanitizeURL()    // Valida y limpia URLs
```

**Previene:**
- SQL Injection
- XSS
- Command Injection
- Path Traversal

### 6. Validación Global

```typescript
// Configuración en main.ts
ValidationPipe({
  whitelist: true,              // Remover propiedades no decoradas
  forbidNonWhitelisted: true,   // Rechazar propiedades extra
  forbidUnknownValues: true,    // Rechazar valores desconocidos
  transform: true,              // Auto-transformación
  validationError: {
    target: false,              // No exponer objeto completo
    value: false,               // No exponer valores sensibles
  }
})
```

### 7. Audit Logging

Ver [AUDIT_COMPLIANCE.md](./AUDIT_COMPLIANCE.md) para detalles completos.

**Características:**
- Registro de todas las operaciones CRUD
- Tracking de usuario, IP, timestamp
- PII flagging
- Compliance tagging
- Retención de 7 años

## Uso de Validadores y Transformers

### Ejemplo: DTO de Buyer

```typescript
import { IsString, IsEmail, IsOptional } from 'class-validator';
import { IsValidSSN } from '../validators/ssn.validator';
import { NormalizeSSN, NormalizeEmail, CapitalizeName } from '../transformers/sanitize.transformer';

export class CreateBuyerDto {
  @IsString()
  @CapitalizeName()
  firstName: string;

  @IsString()
  @CapitalizeName()
  lastName: string;

  @IsEmail()
  @NormalizeEmail()
  email: string;

  @IsOptional()
  @IsValidSSN()
  @NormalizeSSN()
  ssn?: string;
}
```

### Ejemplo: DTO de Vehicle

```typescript
import { IsString } from 'class-validator';
import { IsValidVIN } from '../validators/vin.validator';
import { NormalizeVIN } from '../transformers/sanitize.transformer';

export class CreateVehicleDto {
  @IsString()
  @IsValidVIN()
  @NormalizeVIN()
  vin: string;

  @IsString()
  stockNumber: string;
}
```

## Configuración de Seguridad

### Variables de Entorno

Ver `.env.example` para todas las configuraciones.

**Críticas:**
```env
ALLOWED_ORIGINS=https://yourdomain.com
AUDIT_ENABLED=true
AUDIT_LOG_RETENTION_DAYS=2555
```

### Producción vs Desarrollo

**Desarrollo:**
- Swagger habilitado
- Logs detallados
- CORS permisivo

**Producción:**
- Swagger deshabilitado (opcional)
- Logs solo errores
- CORS restrictivo
- HTTPS obligatorio

## Checklist de Seguridad

### Antes de Deploy

- [ ] Cambiar todas las secrets/keys
- [ ] Configurar ALLOWED_ORIGINS con dominio real
- [ ] Habilitar HTTPS
- [ ] Configurar rate limiting según carga esperada
- [ ] Revisar permisos de base de datos
- [ ] Configurar backups automáticos
- [ ] Configurar monitoreo y alertas
- [ ] Revisar logs de auditoría
- [ ] Actualizar dependencias (npm audit)
- [ ] Ejecutar análisis de seguridad (Snyk, SonarQube)

### Mantenimiento Regular

- [ ] Revisar logs de seguridad semanalmente
- [ ] Actualizar dependencias mensualmente
- [ ] Auditar accesos trimestralmente
- [ ] Revisar compliance anualmente
- [ ] Archivar logs antiguos según política

## Mejores Prácticas

### 1. Nunca Loggear Información Sensible
```typescript
// ❌ MAL
logger.log(`SSN: ${buyer.ssn}`);

// ✅ BIEN
logger.log(`Buyer created: ${buyer.id}`);
```

### 2. Usar Validadores Apropiados
```typescript
// ❌ MAL
@IsString()
ssn: string;

// ✅ BIEN
@IsValidSSN()
@NormalizeSSN()
ssn: string;
```

### 3. Sanitizar Todos los Inputs
```typescript
// ❌ MAL
firstName: string;

// ✅ BIEN
@SanitizeString()
@CapitalizeName()
firstName: string;
```

### 4. Aplicar Audit Logging
```typescript
// ❌ MAL
@Post()
async create() { }

// ✅ BIEN
@Post()
@AuditLog({
  action: 'create',
  resource: 'buyer',
  level: 'critical',
  pii: true,
  compliance: ['routeone', 'glba']
})
async create() { }
```

## Respuesta a Incidentes

### En Caso de Brecha de Seguridad

1. **Contener:**
   - Desactivar acceso comprometido
   - Bloquear IP atacante
   - Revisar logs de auditoría

2. **Evaluar:**
   - Identificar datos comprometidos
   - Determinar alcance del ataque
   - Revisar compliance requirements

3. **Notificar:**
   - Equipo interno
   - RouteOne/DealerTrack (si aplica)
   - Usuarios afectados (GLBA requirement)
   - Autoridades (si aplica)

4. **Remediar:**
   - Cambiar credenciales comprometidas
   - Actualizar sistemas
   - Implementar controles adicionales

5. **Documentar:**
   - Crear reporte de incidente
   - Actualizar procedimientos
   - Entrenar equipo

## Testing de Seguridad

### Pruebas Manuales

```bash
# 1. Test rate limiting
for i in {1..20}; do curl http://localhost:3000/api/v1/media; done

# 2. Test input validation
curl -X POST http://localhost:3000/api/v1/buyers \
  -H "Content-Type: application/json" \
  -d '{"ssn": "invalid"}'

# 3. Test SQL injection
curl -X GET "http://localhost:3000/api/v1/buyers?id=1' OR '1'='1"

# 4. Test XSS
curl -X POST http://localhost:3000/api/v1/buyers \
  -H "Content-Type: application/json" \
  -d '{"firstName": "<script>alert(1)</script>"}'
```

### Pruebas Automatizadas

```typescript
// TODO: Implementar tests de seguridad
describe('Security Tests', () => {
  it('should reject invalid SSN', () => {});
  it('should sanitize XSS attempts', () => {});
  it('should enforce rate limits', () => {});
});
```

## Recursos Adicionales

### Documentación
- [RouteOne Security Requirements](https://www.routeone.com/security)
- [DealerTrack Certification](https://www.dealertrack.com/certification)
- [GLBA Compliance Guide](https://www.ftc.gov/glba)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)

### Herramientas
- [npm audit](https://docs.npmjs.com/cli/v8/commands/npm-audit)
- [Snyk](https://snyk.io/)
- [SonarQube](https://www.sonarqube.org/)
- [OWASP ZAP](https://www.zaproxy.org/)

## Contacto

Para reportar vulnerabilidades de seguridad:
- **Email:** security@htownautos.com
- **Bug Bounty:** No disponible actualmente
- **Response Time:** 24-48 horas

---

**Última actualización:** 2026-01-13
**Versión:** 1.0
**Autor:** HTown Autos Development Team
