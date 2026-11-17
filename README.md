# Vault

Vault es una aplicación de notas para Windows. Se instala como cualquier programa y se abre en su propia ventana. Las notas son archivos Markdown normales (`.md`) dentro de una carpeta, así que también se abren con Obsidian.

## Qué hace

- **Editor tipo Notion** sobre Markdown: bloques de texto, títulos, listas, tareas, citas, código, divisores, tablas e imágenes.
- **Columnas**: arrastra un bloque al borde de otro y se colocan lado a lado; cada columna puede tener su ancho.
- **Callouts** (`> [!tip] Título`), **incrustaciones** de páginas web y vídeos de YouTube, **marcadores web** y botones que crean notas.
- **Medios**: imágenes, vídeo, audio y archivos subidos a la carpeta `attachments`.
- **Bases de datos**: se crean dentro de la página donde estás: `Página/Base.md` es la base y `Página/Base/` la carpeta con sus notas (filas). Vistas de tabla, tablero, galería, lista, número y donut, con filtros, orden, agrupación y un panel ⚙ para configurarlas. Desde otra página puedes insertar una base ya existente. Las propiedades tienen tipo y se pueden calcular con fórmulas (ver *Propiedades de las bases de datos*).
- **Menú de insertar**: escribe `/` o haz clic derecho en un bloque; las opciones están agrupadas por secciones con iconos.
- **Vistas**: resumen de notas, vista de grafo de enlaces y búsqueda con `Ctrl+K`.
- **Propiedades** de la nota (`icon`, `cover`, `width`…) en el frontmatter YAML.
- **Aplicación de escritorio**: instalador, con su propia ventana; no hace falta navegador ni Node.js.

Todo funciona en local: tus notas no salen de tu PC.

## Portada (banner) e icono

Una nota puede tener un banner e icono, como una página de Notion: menú `/` → *Imagen de portada* e *Icono*.

- El banner es una dirección `https://…`, un archivo de tu carpeta de notas (por ejemplo `banner.jpg` en `attachments`) o una imagen que subes desde Vault. El icono puede ser un emoji o una imagen y se solapa con el banner.
- **Encuadrar**: pasa el ratón por el banner y pulsa *Encuadrar*. Se abre la imagen entera con un **marco** que es lo que se verá; arrástralo (o usa las flechas), cambia el **zoom** y la **altura**, y lee cuánto se verá (*Se ve el 63 % del ancho y el 38 % del alto de la imagen*). *Centrar* lo deja en el medio, que es como se ve un banner nuevo.
- Se guarda en la cabecera de la nota, y solo si no son los valores por defecto: `cover`, `cover_x` y `cover_y` (0–100, 50 = centrado), `cover_zoom` (1–3) y `cover_height` (120–420 px, 220 por defecto).
- Una nota puede mostrar solo algunas vistas de una base como pestañas: `use: Leyendo, Leídos, Pendientes`.

El **tutorial** (`notes/Tutorial.md`) y *Ejemplo Biblioteca* son paneles hechos así: banner, icono, tres columnas, botones, galería con pestañas y un gráfico.

## Propiedades de las bases de datos

Cada nota de una base es una fila, y sus propiedades se ven y se editan en la tabla, en las tarjetas y en la cabecera de la propia nota, como en Notion.

- **Añadir**: botón `+` al final de la tabla, o *+ Añadir propiedad* en la cabecera de una fila. Pones el nombre (por ejemplo *Páginas*) y eliges el tipo.
- **Configurar**: haz clic en el nombre de una columna (o de la propiedad en la cabecera de la fila): cambiar nombre o tipo, opciones y colores, formato de número, ocultar en la vista o borrar. Renombrar o borrar cambia todas las filas.
- **Tipos**: Texto, Número, Selección, Selección múltiple, Estado, Fecha, Casilla, URL, Email, Teléfono, Fórmula, Relación, Rollup, Fecha de creación y Última edición.
- **Fechas**: se escriben como `2026-11-16`, `16/11/2026` (día primero) o con hora `16/11/2026 14:30`, y `hoy`. Solo se guardan fechas reales y completas. Se guardan como `2026-11-16` o `2026-11-16T14:30`.
- **Con teclado**: en una celda, `Enter` abre el editor y guarda, `Tab` guarda y cierra, `Esc` cancela, y el foco vuelve a la celda. En el menú de añadir propiedad, `↑`/`↓` eligen el tipo.
- **Fórmulas**, al estilo de Notion: `round(prop("Pages Read") / prop("Page Count") * 100) / 100`. Las funciones también se pueden llamar con punto: `prop("Estado").includes("Done")`. El editor muestra la lista de propiedades y funciones y una vista previa con la primera fila. Funciones: `if ifs empty not and or round floor ceil abs sqrt pow min max sum mean length concat join contains replace replaceAll lower upper slice format toNumber now today dateAdd dateSubtract dateBetween formatDate year month date day`.
- **Números** (también fórmulas y rollups): formato número, con comas, porcentaje, dólar o euro; decimales; y mostrar como número, **barra** o **anillo** con color.
- **Relación** enlaza filas con las de otra base (por ejemplo un libro con sus citas) y **Rollup** calcula sobre las filas enlazadas: contar, sumar, media, mínimo, máximo, porcentaje marcado o mostrar los valores.

Dónde se guarda, para quien abra los archivos a mano o en Obsidian:
- Los **valores** van en el frontmatter de cada nota: `Page Count: 512`, `Genres: [Fantasy, Sci-Fi]`, `Owned: true`, `Started: 2026-11-16`, `Quotes: ["[[Quote 1]]"]`. Las fórmulas, rollups y fechas automáticas se calculan y no se escriben.
- La **definición** (tipo, opciones, fórmula, formato) va en el bloque `database` de la página de la base, con líneas `prop:` antes de las vistas. Las claves del frontmatter que no están definidas se muestran igual, con un tipo deducido.

## Instalar Vault

Descarga el instalador **`Vault-Setup-<versión>.exe`** desde la página de **Releases** del proyecto (https://github.com/alexlo3223/Vault-app/releases). Crea accesos directos en el Escritorio y en el menú Inicio, y se desinstala desde *Configuración → Aplicaciones*. Es la versión que se abre rápido: no hay versión portable, porque tardaba casi 9 segundos en abrirse.

Windows puede avisar de que el programa no está firmado (SmartScreen): pulsa *Más información* → *Ejecutar de todas formas*.

### Dónde se guardan las notas

Vault guarda las notas en **`Documentos\Vault`**. La primera vez que se abre, si esa carpeta está vacía, copia dentro las notas del tutorial. Desde el menú:
- *Archivo → Abrir carpeta de notas* abre esa carpeta en el Explorador.
- *Archivo → Cambiar carpeta de notas…* apunta Vault a otra carpeta (por ejemplo tu bóveda de Obsidian). La app se reinicia y la recuerda.

Solo puede haber una ventana de Vault abierta: si lo abres otra vez, se muestra la que ya estaba.

### Generar los ejecutables (para quien mantiene el proyecto)

1. Instala Node.js 22 o superior y ejecuta `npm install`.
2. Genera los archivos:
   ```
   npm run dist
   ```
   Tarda unos minutos. Crea `dist/Vault Setup <versión>.exe` (el instalador que se publica).
3. Para publicar una versión, sube `version` en `package.json`, confirma y crea en GitHub una *Release* con la etiqueta `v<versión>`, adjuntando los dos `.exe` de `dist/`. Los ejecutables no se guardan en el repositorio (`.gitignore` los excluye).

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
| `npm run dist` | Genera el instalador en `dist/`. Tarda unos minutos la primera vez. |
| `npm start` | Modo navegador: servidor en http://localhost:4321 con las notas de `notes/`. |
| `npm run icon` | Vuelve a generar `app/desktop/icon.png` a partir de `app/public/icon.svg`. |
| `npm run art` | Vuelve a dibujar los banners, portadas e iconos del tutorial en `notes/attachments/`. |
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
- Las relaciones son de un solo sentido: enlazar un libro con una cita no añade el libro en la cita.
- No hay propiedades Person, Files & media, Button, Place ni ID, ni vistas Timeline, Calendar, Chart o Map.
