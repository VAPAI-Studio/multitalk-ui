# 🖼️ Setup de Fotos de Perfil - Guía Rápida

## ✅ Lo que YA está hecho (por mí)

- ✅ Backend completo (API endpoints, storage service, modelos)
- ✅ Frontend completo (UI, componentes, navegación)
- ✅ Validación de archivos
- ✅ Manejo de errores
- ✅ Estados de carga

## 📋 Lo que DEBES hacer (5 minutos)

### Paso 1: Crear el Bucket en Supabase (2 minutos)

1. Abre: https://app.supabase.com/project/rwbhfxltyxaegtalgxdx/storage
2. Click en **"New bucket"**
3. Configura así:
   - **Name**: `user-avatars`
   - **Public bucket**: ❌ **DESACTIVADO** (debe ser privado)
   - **File size limit**: `5242880` (5MB en bytes)
   - **Allowed MIME types**: `image/jpeg,image/jpg,image/png,image/webp`
4. Click en **"Create bucket"**

### Paso 2: Configurar Políticas de Seguridad (2 minutos)

1. Abre: https://app.supabase.com/project/rwbhfxltyxaegtalgxdx/sql
2. Copia TODO el contenido del archivo `backend/setup_profile_pictures.sql`
3. Pégalo en el editor SQL
4. Click en **"Run"** (o Ctrl/Cmd + Enter)
5. Deberías ver: "Success. No rows returned"

### Paso 3: Probar (1 minuto)

```bash
# Terminal 1 - Backend
./runbackend.sh

# Terminal 2 - Frontend
./runfrontend.sh

# Luego en el navegador:
# 1. Inicia sesión
# 2. Click en tu avatar → "⚙️ Editar Perfil"
# 3. Sube una foto
# 4. ¡Listo!
```

---

## 🔍 Verificar que todo funciona

### Test 1: Subir foto
- [ ] Click en "Subir Foto"
- [ ] Selecciona una imagen (JPG, PNG o WebP, max 5MB)
- [ ] Debe aparecer inmediatamente en el menú de usuario

### Test 2: Persistencia
- [ ] Recarga la página (F5)
- [ ] La foto debe seguir apareciendo
- [ ] Cierra sesión y vuelve a iniciar
- [ ] La foto debe cargarse desde Supabase

### Test 3: Eliminar foto
- [ ] Click en "Eliminar"
- [ ] Confirma la acción
- [ ] Debe volver a mostrar las iniciales

### Test 4: Validación
- [ ] Intenta subir un archivo de más de 5MB → Error
- [ ] Intenta subir un archivo no válido (PDF, etc.) → Error

---

## ❌ Si algo falla

### Error: "Failed to upload avatar"
**Solución**: Verifica que el bucket `user-avatars` existe y es privado.

### Error: "Row Level Security policy violation"
**Solución**: Ejecuta las políticas SQL del archivo `backend/setup_profile_pictures.sql`.

### Error: "CORS error"
**Solución**: En Supabase → Storage → user-avatars → Configuration → Allowed origins:
```
http://localhost:5173
http://localhost:8000
```

### La foto no persiste al recargar
**Solución**: Verifica que las políticas SELECT están activas (para leer avatares).

---

## 📂 Estructura de archivos en Supabase

```
user-avatars/
  └── avatars/
      └── {user_id}/
          └── profile.jpg  (o .png, .webp)
```

Ejemplo:
```
user-avatars/avatars/550e8400-e29b-41d4-a716-446655440000/profile.jpg
```

---

## 🎯 Resumen

**Tiempo total**: ~5 minutos

**Pasos**:
1. Crear bucket `user-avatars` (privado, 5MB limit)
2. Ejecutar SQL de `backend/setup_profile_pictures.sql`
3. Probar subiendo una foto

**¡Eso es todo!** El resto ya está implementado y funcionando. 🚀
