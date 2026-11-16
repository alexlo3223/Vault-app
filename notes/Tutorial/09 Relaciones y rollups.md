---
icon: 🔗
cover: banner-bases.jpg
cover_x: 85
cover_y: 70
cover_zoom: 1.3
---

# Relaciones y rollups

Una base puede enlazar sus filas con filas de **otra base**, y resumir lo enlazado.

## Relation

En [[Tutorial/Libros]], la propiedad **Citas** es una *Relation* hacia la base [[Tutorial/Citas]]:

1. Crea la propiedad con tipo *Relation*.
2. En su configuración, elige la base relacionada.
3. Haz clic en la celda para elegir las páginas. Cada elección aparece como un enlace que abre esa página.

En el archivo se guarda como enlaces:

~~~markdown
Citas: ["[[Cita de Dune]]"]
~~~

## Rollup

Un *Rollup* calcula algo sobre las páginas enlazadas. En [[Tutorial/Libros]], **Nº de citas** cuenta las citas de cada libro.

En su configuración eliges:

- la **relación** que usa (*Citas*),
- la **propiedad** de esas páginas que quieres (vacío significa el nombre),
- y el **cálculo**: contar, contar valores, sumar, media, mínimo, máximo, porcentaje marcado, o mostrar los valores originales.

## Límites

- La relación vive en la base que la define: enlazar una cita desde un libro no añade el libro a la cita.

Siguiente: [[10 Vistas y grafo]].
