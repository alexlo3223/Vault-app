---
icon: icono-biblioteca.png
cover: banner-biblioteca.jpg
cover_y: 38
width: full
---

# Biblioteca

<div class="columns">
<div class="column" data-ratio="16">

## Acciones rápidas

<button data-new="Tutorial/Libros">Nuevo libro</button>

<button data-new="Tutorial/Citas">Nueva cita</button>

## Navegación

- [[Libros]]
- [[Citas]]
- [[Tutorial]]
</div>
<div class="column" data-ratio="61">

## Libros en curso

```database
page: Tutorial/Libros
use: Leyendo, Leídos, Pendientes, Todos
```

Los botones de la izquierda crean una fila nueva en la base. Cada pestaña de arriba es una **vista** de la misma base ([[06 Bases de datos]]).

> [!tip] Esto es una nota normal
> Las columnas, los botones, las bases de datos y los gráficos se insertan con `/`. Mira [[04 Columnas y medios]].
</div>
<div class="column" data-ratio="22">

## Páginas por leer

```database
page: Tutorial/Libros
use: Páginas por estado
```

## Total

```database
page: Tutorial/Libros
use: Total de páginas
```
</div>
</div>
