# 04 · Propuesta de puesta en escena y pipeline visual (animación con IA)

> Acompañar al postular con un **lookbook / style bible** (diseños de personajes, paletas, frames de
> referencia y pruebas de pipeline). Recomendado adjuntar un **teaser / prueba de concepto** ya generado.

## 1. Principio rector

*El hombre que pensó que estaba pensando* es un **largometraje de animación realizado con IA generativa**.
La técnica no es un efecto: es la forma misma de la película. Un relato sobre una mente que confunde
**pensar** con **estar** encuentra en la imagen generada —maleable, onírica, capaz de transformarse sin
corte— el lenguaje ideal para deslizarse de lo real a lo soñado.

La película está construida en **tres movimientos** con texturas distintas pero un mismo pulso. El reto es
que el pasaje de lo **real** (Viena) a lo **onírico** (bosque) y al **regreso** (San Francisco) ocurra **sin
costuras visibles**.

| Movimiento | Mundo | Clave visual con IA |
|------------|-------|---------------------|
| I — Viena | Realismo con grietas absurdas | Render controlado, casi fotográfico, paleta gris; composición pictórica y frontal |
| II — El bosque | Fábula / sueño | Libertad generativa: morphing, transiciones imposibles, materia elemental (agua, fuego, barro) |
| III — San Francisco | Regreso transfigurado | Calidez matinal, intimidad doméstica, suspensión |

## 2. El desafío central: consistencia

El mayor reto de una película de IA es la **consistencia** de personajes, vestuario, espacios y luz a lo
largo de ~100 minutos. La estrategia:

- **Biblia visual / style bible**: diseño cerrado de cada personaje (Milton, la Niña, Rose, los niños,
  secundarios), con hojas de referencia (turnarounds, expresiones, vestuario) antes de generar planos.
- **Anclas de identidad**: referencias de personaje reutilizables y, donde aporte, **LoRAs/embeddings
  propios** por personaje y por "mundo" para mantener rasgos y paleta estables entre tomas.
- **Edición dirigida de imagen** con **Nano Banana** para correcciones de continuidad (mismo rostro,
  vestuario, props) sobre frames generados con **Flux** y **Seedream**.
- **Continuidad de color y luz** por secuencia, fijada en la etapa de arte y sostenida en composición.

## 3. Pipeline de producción visual

```
Guion ─► Storyboard / Animática ─► Diseño (style bible, personajes, mundos)
      ─► Keyframes / stills        [Flux · Nano Banana · Seedream]
      ─► Image-to-video / planos    [LTX · Kling · Seedance]
      ─► Lipsync de diálogo         [MultiTalk / InfiniteTalk]
      ─► Voces (actores reales) + Motion capture (gesto/expresión)
      ─► Composición e integración (continuidad, color, limpieza)
      ─► Montaje tradicional ─► Color ─► Sonido y música ─► Máster/DCP
```

- **Generación de imagen (keyframes y diseño):** Flux, Nano Banana, Seedream — definición de cada plano
  clave y de la identidad visual.
- **Image-to-video (movimiento):** LTX, Kling y Seedance para animar los planos; selección de herramienta
  según el tipo de toma (cámara, acción, atmósfera).
- **Lipsync:** MultiTalk / InfiniteTalk sincroniza el diálogo de los personajes con las voces grabadas.
- **Voces:** **actores reales** (dirección de voces), aprovechando el plurilingüismo del guion
  (español, inglés, alemán, yiddish).
- **Motion capture:** soporte puntual para dar **naturalidad de gesto y expresión** a personajes clave en
  momentos dramáticos (la escena de la lápida, la caverna, el reencuentro final).
- **Composición y edición:** flujo **tradicional** —montaje, corrección de color y diseño de sonido— sobre
  los planos generados, para imprimir autoría, ritmo y unidad.

## 4. Dirección de arte y paleta

- **Viena:** lujo institucional y frío; escala de **grises y desaturados** (el guion insiste en el cielo
  nublado), con estallidos puntuales de color (la **estela naranja** de la patinadora) que la IA resuelve
  con naturalidad.
- **El bosque:** verde húmedo, ocre, fuego de los fósforos; la **caverna con pinturas rupestres** (mujer con
  lanza, animal, cacique de plumas) como corazón simbólico. El dibujo de la niña debe rimar exactamente con
  el **dibujo final del hijo en la heladera**.
- **San Francisco:** luz cálida y matinal; austeridad doméstica; el imán-dibujo como objeto-clave del cierre.
- **Motivos a sostener con consistencia:** patines, marcadores de colores, el dibujo del cacique, el agua
  (lluvia, lago, regador), las lápidas, la credencial "M. Bloch".

## 5. Sonido y música

- **Voces** de actores reales como columna de la actuación; casting de voz cuidando matices y acentos.
- **Diseño de sonido** tradicional como puente entre movimientos: pista de patinaje, tractor del cementerio,
  lluvia de la caverna, pájaros del bosque, regador final.
- **Música:** uso diegético y austero (flauta de Ute, piano de la madre uruguaya) + partitura original
  mínima, de cámara. ‹Compositor/a A CONFIRMAR›

## 6. Por qué IA, y por qué uruguaya

- La IA generativa permite a Uruguay producir un **largometraje de animación de horizonte internacional** a
  una **escala financiable**, con **talento local** dirigiendo y operando todo el pipeline.
- Posiciona al país y a la productora en la **frontera técnica** del cine animado, con metodología propia
  (la plataforma de Souts) y capacidad exportable.
- El **gasto elegible** se concentra en **talento y servicios uruguayos**: dirección, diseño, artistas de IA,
  composición, montaje, sonido, música, dirección y grabación de voces, motion capture e infraestructura.

> ⚠️ Confirmar con ACAU/ICAU el encuadre de la **obra generada con IA** (autoría, carácter nacional,
> titularidad de derechos de los materiales y de las herramientas utilizadas).
