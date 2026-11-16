# Vault

Vault es una aplicación de notas que se ejecuta en tu PC y se usa desde el navegador. Las notas son archivos Markdown normales (`.md`) dentro de una carpeta, así que también se abren con Obsidian.

## Qué hace

- **Editor tipo Notion** sobre Markdown: bloques de texto, títulos, listas, tareas, citas, código, divisores, tablas e imágenes.
- **Columnas**: arrastra un bloque al borde de otro y se colocan lado a lado; cada columna puede tener su ancho.
- **Callouts** (`> [!tip] Título`), **incrustaciones** de páginas web y vídeos de YouTube, **marcadores web** y botones que crean notas.
- **Medios**: imágenes, vídeo, audio y archivos subidos a la carpeta `attachments`.
- **Bases de datos**: una base es una página (por ejemplo `Libros.md`) junto a una carpeta con las notas de la base. La página guarda las vistas y cada nota de la carpeta es una fila. Vistas de tabla, tablero, galería, lista, número y donut, con filtros, orden, agrupación y un panel ⚙ para configurarlas.
- **Menú de insertar**: escribe `/` o haz clic derecho en un bloque; las opciones están agrupadas por secciones con iconos.
- **Vistas**: resumen de notas, vista de grafo de enlaces y búsqueda con `Ctrl+K`.
- **Propiedades** de la nota (`icon`, `cover`, `width`…) en el frontmatter YAML.
- **Ejecutable para Windows** (`Vault.exe`): abre la app en su propia ventana sin consola y se cierra solo al cerrar la ventana.

Todo funciona en local: el servidor solo escucha en `127.0.0.1` y no envía tus notas a ningún sitio.

## Requisitos

- **Node.js 22 o superior**: descárgalo de https://nodejs.org (versión LTS).
- **Microsoft Edge o Google Chrome**, para ver la app.

## Cómo ejecutarlo en el PC

1. **Descarga el proyecto.** Con git:
   ```
   git clone https://github.com/alexlo3223/Vault-app.git
   cd Vault-app
   ```
   O descárgalo como ZIP desde GitHub (botón *Code* → *Download ZIP*) y descomprímelo.

2. **Crea la carpeta de notas.** Vault guarda las notas en una carpeta llamada `notes` dentro del proyecto. Si no existe, créala:
   ```
   mkdir notes
   ```
   Puedes apuntar a otra carpeta (por ejemplo tu bóveda de Obsidian) con `--root`, ver más abajo.

3. **Arranca el servidor.** En la carpeta del proyecto:
   ```
   npm start
   ```
   Verás `Vault app: http://localhost:4321`. Deja esa ventana abierta mientras uses Vault.

4. **Abre la app.** En Edge o Chrome ve a http://localhost:4321.
   Para instalarla como app: en la barra de direcciones pulsa el icono *Instalar* (en Edge: *Aplicaciones → Instalar esta página como aplicación*). Se abrirá en su propia ventana.

5. **Para parar Vault**, cierra la ventana de la consola (o pulsa `Ctrl+C` en ella).

### Opciones

- Cambiar el puerto: `PORT=5000 npm start` (en Windows PowerShell: `$env:PORT=5000; npm start`).
- Cambiar la carpeta de notas: `node app/server.mjs --root "C:\Ruta\a\mis\notas"`.

### Ejecutable de Windows (sin consola)

1. Genera el ejecutable en la carpeta del proyecto:
   ```
   npm run build:exe
   ```
   Tarda un minuto y crea `Vault.exe` (unos 93 MB).
2. Haz doble clic en `Vault.exe`. Se abre la app en su propia ventana. Al cerrarla, el proceso se detiene solo.
3. El exe necesita las carpetas `app` y `notes` a su lado: si lo mueves, muévelas también.
4. Windows puede avisar de que el programa no está firmado (SmartScreen). Pulsa *Más información* → *Ejecutar de todas formas*.

## Comprobar que todo funciona

```
npm test
```
Debe terminar con todas las pruebas en verde.

## Estructura

| Carpeta | Contenido |
|---|---|
| `app/server.mjs` | Servidor local: lee y guarda las notas, sirve la app. |
| `app/public/` | La interfaz: editor, bases de datos, vistas, estilos. |
| `app/lib/` | Búsqueda e índice de enlaces entre notas. |
| `app/test/` | Pruebas automáticas. |
| `app/launcher.cjs` | Arranque de `Vault.exe`. |
| `notes/` | Tus notas (no se suben a GitHub). |

## Límites conocidos

- Las webs que no permiten mostrarse dentro de otra página no se pueden incrustar.
- Los vídeos no se pueden adelantar en el reproductor (no hay soporte de rangos HTTP).
- Las bases de datos se recargan al cambiar algo de la página.
- Solo hay una persona usando la app: no tiene cuentas ni acceso desde otros equipos.
