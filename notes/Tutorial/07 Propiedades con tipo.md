---
icon: 🏷️
cover: banner-bases.jpg
cover_y: 30
---

# Propiedades con tipo

En una base, cada columna es una **propiedad** con nombre y tipo. Cada fila (nota) guarda su valor en su propia cabecera.

## Añadir una propiedad

En la tabla, pulsa el `+` al final de la cabecera. Escribe el nombre (por ejemplo *Páginas*) y elige el tipo. En la cabecera de una fila, *+ Añadir propiedad* hace lo mismo.

Tipos disponibles:

| Tipo | Qué guarda | Ejemplo |
|---|---|---|
| Texto | texto libre | autor |
| Número | un número | 412 |
| Selección | una opción | Pendiente |
| Selección múltiple | varias opciones | Ciencia ficción, Fantasía |
| Estado | una opción con estado | Leyendo |
| Fecha | una fecha | 2026-11-16 |
| Casilla | sí o no | ✓ |
| URL, Email, Teléfono | enlaces | https://… |
| Relación | filas de otra base | [[Cita de Dune]] |
| Fórmula | calculado (ver [[08 Fórmulas]]) | 50 % |
| Rollup | resumen de filas relacionadas | 2 citas |
| Fecha de creación, Última edición | fechas automáticas | — |

## Opciones y colores

Selección, Selección múltiple y Estado tienen opciones con color. Escribe en el campo de búsqueda y pulsa `Enter` para **crear** una opción nueva. Para cambiar nombre, color o borrar una, abre la configuración de la propiedad.

## Configurar una propiedad

Haz clic en el nombre de la columna (o de la propiedad en la cabecera de una fila):

- Cambiar nombre o tipo.
- Editar opciones y colores.
- Para números: formato (número, comas, porcentaje, dólar, euro), decimales y **mostrar como número, barra o anillo** con color.
- Ocultar en esta vista o borrar.

Renombrar o borrar una propiedad se aplica a **todas las filas**, y a las fórmulas que la usan.

## Editar valores

Haz clic en la celda (o en el valor de la cabecera de la fila) para editarla. Las casillas cambian al hacer clic.

También se puede **sin ratón**: con el foco en una celda, `Enter` abre su editor, `Enter` guarda, `Tab` guarda y cierra y `Esc` cancela. Tras guardar, el foco vuelve a la misma celda. En un campo de texto, `Shift+Enter` añade una línea nueva.

### Fechas

Escribe la fecha como quieras:

- `2026-11-16`, o `2026/11/16`
- `16/11/2026`, `16-11-2026` o `16.11.2026` (el **día va primero**: `1/2/2026` es 1 de febrero)
- con hora, si quieres: `16/11/2026 14:30`
- `hoy` pone la fecha de hoy

Mientras escribes, el panel te dice cómo la ha entendido (*Se guardará: 16 nov 2026*). Solo se guardan fechas completas y reales: `30/02/2026` o `16/11/26` (año de dos cifras) no se guardan y el panel te lo explica. Los botones **Hoy**, **Calendario** y **Borrar** hacen lo que dicen. En el archivo la fecha queda como `2026-11-16` (o `2026-11-16T14:30`), que Obsidian también entiende.

Si un archivo tiene una fecha o un número que no se puede leer (por ejemplo `Fecha: el viernes`), Vault lo muestra tal cual, subrayado, para que lo corrijas.

## Dónde se guarda

Los valores van en la cabecera de cada nota, así que Obsidian también los lee:

~~~markdown
---
Páginas: 412
Estado: Leído
Géneros: [Ciencia ficción]
Valoración: 5
---
~~~

Las definiciones (tipo, opciones, fórmula) van en el bloque de la página de la base.

Ejemplo real: [[Tutorial/Libros]]. Siguiente: [[08 Fórmulas]].
