---
icon: 🌊
cover: banner-inicio.jpg
cover_x: 78
cover_zoom: 1.6
---

# Propiedades de la página

Las propiedades van al principio de la nota, entre dos líneas `---`. Vault las muestra arriba como una ficha, salvo las que describen cómo se ve la página (icono, banner y ancho), que se ven directamente.

~~~markdown
---
icon: 🌊
cover: banner-inicio.jpg
cover_x: 78
cover_zoom: 1.6
width: full
---
~~~

- **icon**: un emoji o una imagen que aparece junto al título. Desde el menú, *Icono*.
- **cover**: la imagen del banner. Desde el menú, *Imagen de portada*.
- **width**: `full` hace la página ancha. Desde el menú, *Ancho completo*.

Cualquier otra clave que escribas aquí también aparece en la ficha, y es lo que usan las bases de datos para sus columnas (ver [[07 Propiedades con tipo]]).

## El banner

Esta nota tiene banner: es la imagen de arriba. Puede ser una dirección `https://…`, un archivo de tu carpeta de notas (como `banner-inicio.jpg`, que está en `attachments`) o una imagen que subas desde Vault.

### Encuadrarlo

Pasa el ratón por encima del banner y pulsa **Encuadrar**. Se abre una ventana con la **imagen entera** y, encima, un **marco** que es justo lo que se verá en el banner; lo de fuera del marco aparece oscurecido.

- **Arrastra el marco** para elegir qué parte de la imagen se ve. Pulsar fuera del marco lo lleva allí.
- Con el marco seleccionado, las **flechas** lo mueven (con `Shift`, de cinco en cinco) y `+` / `-` cambian el zoom.
- **Zoom** acerca la imagen: el marco se hace más pequeño y se ve menos.
- **Altura** cambia lo alto que es el banner.
- **Centrar** lo deja en el medio, que es como se ve un banner nuevo.
- Un texto te dice cuánto se verá: *Se ve el 100 % del ancho y el 59 % del alto de la imagen*. Debajo está la **vista previa** del banner real.

**Cambiar imagen** abre la misma ventana con el campo de la imagen: escribe una dirección o el nombre de un archivo, o pulsa **Subir imagen…**. **Quitar** borra el banner.

### Dónde se guarda

El encuadre son cuatro claves más en la cabecera, y solo aparecen si no son las de por defecto:

| Clave | Qué es | Por defecto |
|---|---|---|
| `cover_x`, `cover_y` | el punto de la imagen que queda fijo en el marco, de 0 a 100 | 50, 50 (el medio) |
| `cover_zoom` | cuánto se acerca, de 1 a 3 | 1 |
| `cover_height` | lo alto del banner, en píxeles | 220 |

Esta nota usa `cover_x: 78` y `cover_zoom: 1.6`: por eso el banner enseña la esquina derecha de la imagen, más cerca. Prueba a cambiar esos números o a abrir el editor.

## Iconos con imagen

`icon` también acepta una imagen, como en [[Tutorial]]: `icon: icono-vault.png`. Se muestra grande, sobre el borde del banner.

Siguiente: [[06 Bases de datos]].
