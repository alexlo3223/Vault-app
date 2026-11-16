---
icon: 🧮
cover: banner-bases.jpg
cover_x: 18
cover_zoom: 1.5
---

# Fórmulas

Una fórmula calcula un valor a partir de otras propiedades de la misma fila. Se escribe como en Notion, con `prop("Nombre")` para leer una propiedad.

## Ejemplo: progreso de lectura

En la propiedad *Progreso* de [[Tutorial/Libros]]:

~~~text
round(prop("Leídas") / prop("Páginas") * 100) / 100
~~~

Con formato **porcentaje** y **barra**, 210 de 662 páginas se ve como una barra a un 32 %. Para cambiar el formato, abre la configuración de la propiedad y elige *Number format* y *Show as*.

## Cómo escribirla

- Abre el editor con **Edit formula** desde la configuración de la propiedad.
- A la izquierda están las propiedades y las funciones. Haz clic en una propiedad para insertar `prop("…")`, o en una función para insertarla.
- Abajo ves una **vista previa** con la primera fila y el tipo de resultado.
- `Ctrl+Enter` guarda.

## Notación con punto

Una función también puede llamarse sobre un valor, con un punto, como en Notion. Estas dos líneas dan lo mismo:

~~~text
if(prop("Estado").includes("Leído"), "Hecho", "")
if(includes(prop("Estado"), "Leído"), "Hecho", "")
~~~

La forma de punto se lee de izquierda a derecha, y permite encadenar: `prop("Géneros").join(" · ").toUpperCase()`.

## Operadores

- Aritmética: `+ - * / %` y potencias `^`.
- Comparación: `== != > >= < <=`.
- Lógica: `and`, `or`, `not`.
- Texto: `"Vol. " + 2` une textos.
- Condicional: `if(condición, si_verdadero, si_falso)` o `ifs(…)` para varias condiciones.

~~~text
ifs(prop("pages") >= 400, "Largo", prop("pages") >= 300, "Medio", "Corto")
~~~

## Funciones útiles

- Números: `round(n, decimales)`, `floor`, `ceil`, `abs`, `min`, `max`, `sum`, `mean`.
- Texto: `length`, `upper`, `lower`, `replace`, `slice`, `join`.
- Listas: `contains(lista, valor)`, `length(lista)`, `join(lista, " · ")`.
- Fechas: `today()`, `dateAdd(fecha, 7, "days")`, `dateBetween(a, b, "days")`, `formatDate(fecha, "DD/MM/YYYY")`, `year`, `month`, `day`.

## Errores

Si una fórmula falla, su celda muestra **⚠ Error**; pasa el ratón para leer el motivo. El resto de la vista sigue funcionando. Ejemplos de errores: una propiedad que no existe, o una fórmula que usa otra y forma un bucle.

Si divides entre cero, el resultado queda vacío en lugar de dar error.

Siguiente: [[09 Relaciones y rollups]].
