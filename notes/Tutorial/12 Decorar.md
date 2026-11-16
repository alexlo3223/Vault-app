---
icon: 🎨
cover: banner-vistas.jpg
cover_y: 40
---

# Decorar mientras escribes

Vault no tiene un editor de estilos aparte: el aspecto sale de **lo que escribes** y de unas pocas **propiedades** de la nota. Esta página recorre cada recurso visual y cómo usarlo en tu propio texto sin perder el hilo.

## 1. Títulos como jerarquía

Escribe `#`, `##` o `###` seguido de espacio. Cada nivel tiene su tamaño y su tipografía.

- `#` para el título de la sección principal.
- `##` para las subsecciones.
- `###` para detalles dentro de una subsección.

Un buen patrón: un solo `#` por nota y luego `##` para las partes. Así la tabla de contenidos del menú lateral queda legible.

## 2. Énfasis en línea

| Escribes | Ves | Atajo |
|---|---|---|
| `**así**` | **así** | `Ctrl+B` |
| `*así*` o `_así_` | *así* | `Ctrl+I` |
| `` `así` `` | `así` | — |

Úsalo con poca frecuencia: si todo está en negrita, nada destaca.

## 3. Callouts: el adorno con más carácter

Un callout es un aviso con borde de color. Se escribe como una cita cuya primera línea tiene la etiqueta `[!tipo]`:

~~~markdown
> [!tip] Consejo
> Texto del aviso, puede tener **negritas** y [[enlaces]].
~~~

Los tipos y su color:

> [!note] `note` (azul)
> Información neutral: una aclaración.

> [!info] `info` (azul)
> Contexto útil que no es urgente.

> [!tip] `tip` (verde)
> Atajos y recomendaciones.

> [!success] `success` (verde)
> Algo ya resuelto o confirmado.

> [!warning] `warning` (rojo)
> Algo que conviene revisar antes de seguir.

> [!danger] `danger` (rojo)
> Algo que puede romper datos si se hace mal.

Para insertarlo sin escribir la sintaxis: `/callout` crea uno de tipo `note`, y luego cambias la etiqueta.

**Consejo de uso:** un callout por sección. Si hay cinco, el lector deja de leerlos.

## 4. Citas y divisores

- `>` al inicio de una línea hace una **cita**: fondo tenue y barra dorada a la izquierda. Varias líneas seguidas forman un solo bloque.
- `---` en una línea crea un **divisor**. Úsalo para separar temas grandes, no párrafos.

> Una cita sirve para una frase ajena o una idea que quieres destacar, no para un párrafo entero.

## 5. Listas y tareas

- `-` lista de viñetas, con sangría (Tab) para anidar.
- `1.` lista numerada.
- `[]` tarea. `Ctrl+Enter` sobre ella alterna hecha / pendiente.

- [ ] Redacta el borrador
- [x] Elige el banner
- [ ] Revisa los enlaces

Las tareas se leen bien en una nota de seguimiento: combina `##` para la semana y `[ ]` para lo pendiente.

## 6. Enlaces que se leen como texto

- `[[Nombre de nota]]` enlaza a otra nota.
- `[[Nombre de nota|texto que ves]]` enlaza con otro texto, por ejemplo `[[Libros|mis libros]]`.
- `[texto](https://…)` es un enlace externo con texto propio.
- `#etiqueta` marca un tema. Haz clic para ver todas las notas con esa etiqueta.

Así puedes escribir frases naturales: *Empecé [[Dune|el libro]] el lunes* sin que el lector vea la estructura de carpetas.

## 7. Iconos: el primer adorno de la página

La propiedad `icon` pone un icono junto al título. Acepta:

- Un emoji: `icon: 🎨`
- Una imagen de tu carpeta: `icon: icono-vault.png`
- Una dirección `https://…`

Desde el menú: `/` → *Icono*. Para quitarlo, déjalo vacío.

Elige un emoji por tipo de nota y mantenlo: 📚 libros, 🎲 partidas, 🧪 pruebas. Tus notas se reconocen de un vistazo en el menú lateral.

## 8. El banner

La propiedad `cover` pone una imagen ancha arriba de la página. Pasa el ratón por el banner y pulsa **Encuadrar** para elegir qué parte se ve: arrastra el marco, usa el zoom y la altura.

~~~markdown
---
cover: banner-vistas.jpg
cover_x: 40
cover_y: 60
cover_zoom: 1.5
cover_height: 260
---
~~~

- `cover_x` y `cover_y` (0 a 100): el punto de la imagen que queda fijo.
- `cover_zoom` (1 a 3): cuánto se acerca.
- `cover_height`: altura en píxeles.

Si no pones valores, el banner se centra y ocupa 220 píxeles.

**Consejo:** usa la misma imagen en todas las notas de una sección y cambia solo `cover_y`. Da coherencia sin esfuerzo.

## 9. Ancho de la página

`width: full` quita el límite de ancho y deja el texto ocupar la ventana. Úsalo para bases de datos anchas o tablas largas; deja el resto de notas en el ancho normal, que se lee mejor.

Desde el menú: *Ancho completo*.

## 10. Columnas

Arrastra un bloque hasta el borde de otro para ponerlos lado a lado, o usa `/` → *2 columnas*, *3 columnas* o *3 columnas, estrecha · ancha · estrecha*.

Úsalo para:

- Una imagen a la izquierda y su descripción a la derecha.
- Dos listas comparadas (pros y contras).
- Una tarjeta de datos junto a su explicación.

No abuses de columnas en textos largos: en móvil se apilan y el orden puede confundir.

## 11. Colores en bases de datos

Las opciones de *Selección*, *Selección múltiple* y *Estado* tienen color. Son nueve: gris, marrón, naranja, amarillo, verde, azul, morado, rosa y rojo.

Asigna colores con sentido, no al azar:

- Verde para lo terminado (*Hecho*, *Leído*).
- Azul para lo que está en marcha (*En curso*).
- Rojo para lo urgente o bloqueado.
- Gris para lo que no empezó.

En una base de libros, por ejemplo: verde = leído, azul = leyendo, gris = pendiente. Un vistazo a la tabla te dice el estado de todo.

Los valores de *Selección*, *Selección múltiple* y *Estado* se muestran como etiquetas con su color en cada celda.

## 12. Donut y barras con color

En una propiedad *Número* puedes mostrar el valor como **número**, **barra** o **anillo**, y elegir su color. Úsalo para valoraciones, progreso o presupuesto:

- Barra verde para el progreso de lectura.
- Anillo amarillo para una meta mensual.

El color de la barra sigue la misma paleta: elige uno que contraste con el fondo oscuro.

## 13. Decorar con fórmulas

Una fórmula que devuelve texto se muestra como una etiqueta **gris**: no toma color de ninguna opción. Si quieres colores por estado, usa una propiedad *Estado* en lugar de una fórmula. Mira [[08 Fórmulas]] para la sintaxis de los cálculos.

## Receta: una nota decorada de principio a fin

~~~markdown
---
icon: 📚
cover: banner-biblioteca.jpg
cover_y: 30
---

# Libros de este mes

> [!tip] Objetivo
> Terminar **tres** libros antes del día 30.

## Leyendo ahora

- [ ] [[Dune|Dune]], capítulo 4
- [x] [[Piranesi]] terminado

#lectura #otoño

---

## Notas

> [!warning] Pendiente
> Devolver el ejemplar de la biblioteca el viernes.
~~~

Pruébala: crea una nota nueva, pega esto y cambia el banner con **Encuadrar**. En dos minutos tienes una página que se lee de un vistazo.

## Lo que Vault no hace (para no buscarlo)

- No hay subrayado, color de texto libre ni resaltado con `==`. Para resaltar usa un callout o una negrita.
- No hay tamaños de letra a medida: solo los tres niveles de título.
- No hay tablas con estilo propio: una tabla simple usa el aspecto del tema.

Si necesitas algo de esto, pide que se añada; el resto se resuelve con callouts y títulos.

Vuelve a [[Tutorial]] o sigue con [[11 Aplicación de escritorio]].
