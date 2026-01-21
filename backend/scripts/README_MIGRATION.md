# User ID Migration Guide

## Objetivo

Asignar un `user_id` aleatorio a todos los jobs existentes que tienen `user_id = NULL`.

## Pre-requisitos

1. **Al menos un job con user_id existente**: El script necesita al menos un usuario existente en los jobs para poder asignar aleatoriamente.
2. **Variables de entorno configuradas**: `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` en el archivo `.env`

## Opciones de Ejecución

### Opción 1: Script Python (Recomendado)

Este script permite hacer un dry-run primero para ver qué cambios se harían.

#### Paso 1: Instalar dependencias

```bash
cd backend
pip install supabase
```

#### Paso 2: Dry-run (recomendado primero)

Ver qué cambios se harían sin aplicarlos:

```bash
python scripts/migrate_null_user_ids.py --dry-run
```

Ejemplo de salida:
```
============================================================
🔄 User ID Migration Script
============================================================
Started at: 2025-01-21 10:30:00
🧪 DRY RUN MODE - No changes will be made
============================================================
📊 Fetching all users...
✅ Found 3 unique users from existing jobs

🎲 Will randomly assign jobs to 3 users

🎬 Migrating video_jobs...
  Found 45 video jobs with NULL user_id
  [DRY RUN] Would assign random user_id to these jobs
    - Job a1b2c3d4... (lipsync-one) → User e5f6g7h8...
    - Job i9j0k1l2... (lipsync-multi) → User m3n4o5p6...
    ... and 43 more

🖼️  Migrating image_jobs...
  Found 23 image jobs with NULL user_id
  [DRY RUN] Would assign random user_id to these jobs
    ...
```

#### Paso 3: Ejecutar migración real

Si el dry-run se ve bien, ejecutar sin el flag:

```bash
python scripts/migrate_null_user_ids.py
```

Ejemplo de salida:
```
============================================================
🔄 User ID Migration Script
============================================================
Started at: 2025-01-21 10:35:00
⚠️  LIVE MODE - Changes will be written to database
============================================================
📊 Fetching all users...
✅ Found 3 unique users from existing jobs

🎲 Will randomly assign jobs to 3 users

🎬 Migrating video_jobs...
  Found 45 video jobs with NULL user_id
  Progress: 10/45 video jobs updated
  Progress: 20/45 video jobs updated
  Progress: 30/45 video jobs updated
  Progress: 40/45 video jobs updated
  ✅ Updated 45 video jobs

🖼️  Migrating image_jobs...
  Found 23 image jobs with NULL user_id
  Progress: 10/23 image jobs updated
  Progress: 20/23 image jobs updated
  ✅ Updated 23 image jobs

📝 Migrating text_jobs...
  ✓ No text jobs need migration

============================================================
📊 Migration Summary
============================================================
Video Jobs:  45 updated, 0 failed
Image Jobs:  23 updated, 0 failed
Text Jobs:   0 updated, 0 failed
------------------------------------------------------------
TOTAL:       68 updated, 0 failed

✅ Migration completed successfully!

Finished at: 2025-01-21 10:35:15
============================================================
```

### Opción 2: Script SQL Directo

Ejecutar el script SQL directamente en Supabase.

#### Pasos:

1. Ir a Supabase Dashboard → SQL Editor
2. Abrir el archivo `backend/sql/migrations/002_assign_random_user_ids.sql`
3. Copiar y pegar el contenido completo
4. Ejecutar

#### Salida esperada:

```
NOTICE:  Starting video_jobs migration...
NOTICE:  Updated 10 video jobs...
NOTICE:  Updated 20 video jobs...
NOTICE:  Updated 30 video jobs...
NOTICE:  Updated 40 video jobs...
NOTICE:  Completed video_jobs migration: 45 jobs updated

NOTICE:  Starting image_jobs migration...
NOTICE:  Updated 10 image jobs...
NOTICE:  Updated 20 image jobs...
NOTICE:  Completed image_jobs migration: 23 jobs updated

NOTICE:  Starting text_jobs migration...
NOTICE:  Completed text_jobs migration: 0 jobs updated

NOTICE:  === Migration Verification ===
NOTICE:  Remaining NULL user_ids:
NOTICE:    Video Jobs: 0
NOTICE:    Image Jobs: 0
NOTICE:    Text Jobs: 0
NOTICE:  ✅ Migration completed successfully - no NULL user_ids remaining
```

## Verificación Post-Migración

### Verificar que no quedan NULL user_ids:

```sql
-- Video jobs
SELECT COUNT(*) as null_count FROM video_jobs WHERE user_id IS NULL;

-- Image jobs
SELECT COUNT(*) as null_count FROM image_jobs WHERE user_id IS NULL;

-- Text jobs
SELECT COUNT(*) as null_count FROM text_jobs WHERE user_id IS NULL;
```

Todos deberían devolver `0`.

### Verificar distribución de jobs por usuario:

```sql
-- Video jobs por usuario
SELECT user_id, COUNT(*) as job_count
FROM video_jobs
GROUP BY user_id
ORDER BY job_count DESC;

-- Image jobs por usuario
SELECT user_id, COUNT(*) as job_count
FROM image_jobs
GROUP BY user_id
ORDER BY job_count DESC;
```

## Troubleshooting

### Error: "No users found from existing jobs"

**Problema**: No hay ningún job con `user_id` asignado.

**Solución**:
1. Primero, crea al menos un job nuevo con el sistema actualizado
2. El nuevo job tendrá `user_id` automáticamente
3. Luego ejecuta la migración

### Error: "Missing required environment variables"

**Problema**: Faltan las variables de entorno de Supabase.

**Solución**:
1. Verifica que existe el archivo `backend/.env`
2. Verifica que contiene:
   ```
   SUPABASE_URL=https://xxxxx.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...
   ```
3. Reinicia el script

### Error: "Permission denied" en SQL

**Problema**: El usuario no tiene permisos para actualizar las tablas.

**Solución**:
- Ejecuta el script SQL desde el SQL Editor de Supabase Dashboard
- O asegúrate de usar `SUPABASE_SERVICE_ROLE_KEY` (no `SUPABASE_ANON_KEY`)

## Notas Importantes

1. **Distribución aleatoria**: Los jobs se asignan aleatoriamente entre los usuarios existentes
2. **No reversible fácilmente**: Una vez ejecutado, no hay forma automática de deshacer. Haz backup si es necesario
3. **RLS Policies**: Las políticas RLS permitirán que cada usuario vea sus jobs asignados
4. **Jobs futuros**: Los nuevos jobs (después del cambio de código) automáticamente tendrán `user_id` correcto

## Pasos Siguientes

Después de la migración:

1. ✅ Verificar que los nuevos jobs tienen `user_id` correcto
2. ✅ Probar el filtro "My Content" / "All" en la UI
3. ✅ Verificar que cada usuario ve solo sus propios jobs en "My Content"
4. ✅ Verificar que "All" muestra todos los jobs (sin importar usuario)
