---
icon: 🗃️
cover: banner-bases.jpg
---

# Bases de datos

Una base de datos es una **página** y una **carpeta** con el mismo nombre dentro de la página donde la creas:

- `Página/Base.md` es la base: guarda sus vistas y sus propiedades.
- `Página/Base/` es la carpeta. **Cada nota dentro es una fila.**

## Crear una base

1. En una nota, escribe `/` y elige *Tabla* (o *Tablero*, *Galería*, *Lista*, *Número* o *Gráfico de donut*).
2. Pulsa *Crear una base de datos nueva* y escribe el nombre.
3. Vault crea la página de la base y su carpeta. Las filas se añaden con **+ Nueva**.

Para usar una base que ya existe, elígela en el mismo menú.

## Las vistas

Una base puede tener varias vistas. Cada una muestra las mismas filas de otra manera:

- **Tabla**: una fila por nota, con sus propiedades en columnas.
- **Tablero**: columnas por valor de una propiedad (por ejemplo *Estado*).
- **Galería**: tarjetas con portada.
- **Lista**: una línea por fila.
- **Número** y **Donut**: totales y reparto.

Abre la página de la base para cambiar de vista con las pestañas, añadir una con `+`, o ajustar filtros, orden y agrupación con ⚙.

## Ejemplo: la base de libros

Esta es la base del tutorial, insertada en la nota con su vista *Tabla*:

```database
page: Tutorial/Libros
use: Tabla
```

Una nota puede mostrar **solo algunas** de las vistas, como pestañas: `use: Leyendo, Leídos, Pendientes`. Con un solo nombre muestra esa vista sin pestañas. Así se hizo el panel de [[Ejemplo Biblioteca]].

Abre [[Tutorial/Libros]] para ver todas sus vistas y su esquema completo.

Siguiente: [[07 Propiedades con tipo]].
