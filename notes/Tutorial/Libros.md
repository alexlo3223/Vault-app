---
icon: icono-biblioteca.png
cover: banner-biblioteca.jpg
cover_y: 62
---

~~~database
source: Tutorial/Libros
prop: Páginas
type: number
prop: Leídas
type: number
prop: Progreso
type: formula
formula: round(prop("Leídas") / prop("Páginas") * 100) / 100
format: percent
display: bar
color: purple
prop: Estado
type: status
options: Pendiente=gray, Leyendo=blue, Leído=green
prop: Géneros
type: multi-select
options: Ciencia ficción=purple, Fantasía=orange, Misterio=pink
prop: Valoración
type: number
display: ring
color: yellow
max: 5
prop: Citas
type: relation
relation: Tutorial/Citas
prop: Nº de citas
type: rollup
rollup: Citas
calc: count
prop: Portada
type: text
name: Tabla
view: table
show: Páginas, Leídas, Progreso, Estado, Géneros, Valoración, Citas, Nº de citas
---
name: Leyendo
view: gallery
show: Progreso, Géneros
filter: Estado = Leyendo
preview: property:Portada
---
name: Leídos
view: gallery
show: Valoración, Géneros
filter: Estado = Leído
preview: property:Portada
---
name: Pendientes
view: gallery
show: Páginas, Géneros
filter: Estado = Pendiente
preview: property:Portada
---
name: Todos
view: gallery
show: Estado, Progreso
preview: property:Portada
---
name: Por estado
view: board
group: Estado
---
name: Páginas por estado
view: donut
group: Estado
value: Páginas
agg: sum
---
name: Total de páginas
view: number
value: Páginas
agg: sum
~~~
