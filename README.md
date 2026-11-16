# Vault

Vault es una aplicación de notas para Windows. Se instala como cualquier programa y se abre en su propia ventana. Las notas son archivos Markdown normales (`.md`) dentro de una carpeta, así que también se abren con Obsidian.

## Qué hace

- **Editor tipo Notion** sobre Markdown: bloques de texto, títulos, listas, tareas, citas, código, divisores, tablas e imágenes.
- **Columnas**: arrastra un bloque al borde de otro y se colocan lado a lado; cada columna puede tener su ancho.
- **Callouts** (`> [!tip] Título`), **incrustaciones** de páginas web y vídeos de YouTube, **marcadores web** y botones que crean notas.
- **Medios**: imágenes, vídeo, audio y archivos subidos a la carpeta `attachments`.
- **Bases de datos**: una base es una página (por ejemplo `Libros.md`) junto a una carpeta con las notas de la base. La página guarda las vistas y cada nota de la carpeta es una fila. Vistas de tabla, tablero, galería, lista, número y donut, con filtros, orden, agrupación y un panel ⚙ para configurarlas.
- **Menú de insertar**: escribe `/` o haz clic derecho en un bloque; las opciones están agrupadas por secciones con iconos.
- **Vistas**: resumen de notas, vista de grafo de enlaces y búsqueda con `Ctrl+K`.
- **Propiedades** de la nota (`icon`, `cover`, `width`…) en el frontmatter YAML.
- **Aplicación de escritorio**: instalador o versión portable, con su propia ventana; no hace falta navegador ni Node.js.

Todo funciona en local: tus notas no salen de tu PC.

## Instalar Vault

### Opción 1: usar `Vault.exe` del repositorio (sin instalar)

1. Instala **Git** y **Git LFS** (https://git-lfs.com; en Windows viene con *Git for Windows*).
2. Clona el proyecto y activa LFS (una sola vez):
   ```
   git lfs install
   git clone https://github.com/alexlo3223/Vault-app.git
   cd Vault-app
   ```
   Si ya lo tenías clonado sin LFS, ejecuta `git lfs pull` dentro de la carpeta. `Vault.exe` debe pesar unos 110 MB; si pesa unos cientos de bytes, es solo un puntero de LFS y falta `git lfs pull`.
3. Haz doble clic en **`Vault.exe`** (en la raíz del proyecto). Se abre en su propia ventana.
4. Windows puede avisar de que el programa no está firmado (SmartScreen): pulsa *Más información* → *Ejecutar de todas formas*.

También puedes descargar `Vault.exe` suelto desde la página de *Releases* de GitHub, sin clonar nada.

### Opción 2: instalador

Si generas el instalador (ver *Generar los ejecutables*), obtendrás `dist/Vault Setup 1.0.0.exe`: crea accesos directos en el Escritorio y en el menú Inicio, y se desinstala desde *Configuración → Aplicaciones*.

### Dónde se guardan las notas

Vault guarda las notas en **`Documentos\Vault`**. Desde el menú:
- *Archivo → Abrir carpeta de notas* abre esa carpeta en el Explorador.
- *Archivo → Cambiar carpeta de notas…* apunta Vault a otra carpeta (por ejemplo tu bóveda de Obsidian). La app se reinicia y la recuerda.

Solo puede haber una ventana de Vault abierta: si lo abres otra vez, se muestra la que ya estaba.

### Generar los ejecutables (para quien mantiene el proyecto)

1. Instala Node.js 22 o superior y ejecuta `npm install`.
2. Genera los archivos:
   ```
   npm run dist
   ```
   Tarda unos minutos. Crea `dist/Vault Setup 1.0.0.exe` (instalador) y `dist/Vault-1.0.0-portable.exe` (portable).
3. Para actualizar el `Vault.exe` del repositorio, copia el portable a la raíz con ese nombre y sube el cambio:
   ```
   copy dist\Vault-1.0.0-portable.exe Vault.exe
   git add Vault.exe
   git commit -m "Actualizar Vault.exe"
   git push
   ```
   Git LFS (configurado en `.gitattributes`) guarda el `.exe` automáticamente.

## Desarrollo

Requisitos: **Node.js 22 o superior** (https://nodejs.org, versión LTS).

```
git clone https://github.com/alexlo3223/Vault-app.git
cd Vault-app
npm install
```

| Comando | Qué hace |
|---|---|
| `npm run desktop` | Abre la app de escritorio sin empaquetar (usa la carpeta de notas configurada). |
| `npm run dist` | Genera el instalador y el portable en `dist/`. Tarda unos minutos la primera vez. |
| `npm start` | Modo navegador: servidor en http://localhost:4321 con las notas de `notes/`. |
| `npm run icon` | Vuelve a generar `app/desktop/icon.png` a partir de `app/public/icon.svg`. |
| `npm test` | Pruebas automáticas; deben terminar todas en verde. |

En modo navegador puedes cambiar el puerto con `--port 5000` y la carpeta con `--root` (`node app/server.mjs --root "C:\Ruta\a\mis\notas"`).

Si al ejecutar `npm run desktop` desde el terminal de VS Code Electron se comporta como Node (sin ventana), es porque VS Code define `ELECTRON_RUN_AS_NODE`: bórrala antes (`Remove-Item Env:ELECTRON_RUN_AS_NODE` en PowerShell).

## Estructura

| Carpeta | Contenido |
|---|---|
| `app/desktop/` | La app de escritorio (Electron): ventana, menú, carpeta de notas e icono. |
| `app/server.mjs` | Servidor interno: lee y guarda las notas y sirve la interfaz. |
| `app/public/` | La interfaz: editor, bases de datos, vistas, estilos. |
| `app/lib/` | Búsqueda e índice de enlaces entre notas. |
| `app/test/` | Pruebas automáticas. |
| `notes/` | Notas de ejemplo para el modo navegador (`npm start`). |
| `scripts/` | Utilidades de desarrollo (generar el icono). |

## Límites conocidos

- Las webs que no permiten mostrarse dentro de otra página no se pueden incrustar.
- Los vídeos no se pueden adelantar en el reproductor (no hay soporte de rangos HTTP).
- Las bases de datos se recargan al cambiar algo de la página.
- Solo hay una persona usando la app: no tiene cuentas ni acceso desde otros equipos.
- El ejecutable no está firmado, así que Windows muestra el aviso de SmartScreen la primera vez.
