# Documento de Diseño — Colonia Marte

> **Título de trabajo:** TBD (ej. "Mars Pet Colony")
> **Género:** Cuidado de mascotas (Tamagotchi) + breeding genético + colección, con hub social.
> **Plataforma:** Decentraland (SDK7, servidor autoritativo).
> **Estado:** Rediseño sobre la base de *My Dear Pet* (MVP de cuidado ya construido).

Este documento tiene dos partes:
- **Parte A — La visión completa del juego** (hacia dónde va).
- **Parte B — El MVP de 2 meses + plan de validación** (qué se construye ahora y cómo se mide).

---

# PARTE A — La visión del juego

## 1. Concepto central

En una colonia en **Marte**, cada jugador **adopta y cuida** mascotas. Cuidarlas bien las mantiene sanas, y una mascota sana es una **mejor reproductora**: al llegar a cierto nivel podés **cruzarla con la mascota de otro jugador** para generar una **cría** que hereda rasgos visibles (color, patrón, rareza). Cada cría **puebla la colonia marciana**, que crece y se pone más linda a medida que la comunidad la construye.

El cuidado es el latido diario; el breeding es el motor de colección y de interacción social; la colonia es el propósito que le da sentido a todo.

## 2. Pilares de diseño

1. **Loop solo, envuelto en lo social.** Se juega principalmente en single-player (ver Pilar 5), pero vive en un espacio compartido.
2. **El descuido tiene consecuencias reales.** Los stats decaen en tiempo real, incluso offline. Volver a cuidar es el gancho emocional (culpa/retorno estilo Tamagotchi).
3. **Cuidar bien ES la economía.** La calidad del cuidado determina la calidad de las crías, que son tu colección, tu status y tu ingreso. No es una tarea que tolerás: es el centro de todo.
4. **Status visible.** La rareza es **cosmética** — se ve. En un hub social, lo visible es lo que engancha.
5. **Async-first.** Todo lo social funciona aunque el otro jugador esté offline. Coincidir online es un bonus, nunca un requisito. (Necesario por la baja concurrencia de DCL hoy.)

## 3. El core loop — tres loops anidados

El juego no son tres features sueltas, son tres loops que se alimentan entre sí:

| Loop | Frecuencia | Qué hacés | Qué engancha |
|------|-----------|-----------|--------------|
| **Cuidar** | Diario (minutos) | Mantener la mascota sana/feliz | Volver (decay offline = culpa) |
| **Criar** | Semanal (días) | Cruzar con la mascota de otro → cría nueva | Sorpresa + colección + social |
| **Colonia** | Largo (semanas) | Cada cría hace crecer Marte | El propósito de todo lo anterior |

Cada loop existe **para** el siguiente: cuidás **porque** sube el nivel para poder criar; criás **porque** las crías son raras y agrandan la colonia; la colonia crece **porque** seguís el ciclo.

## 4. La mecánica clave: cuidado → genética

Esta es la decisión de diseño que hace que todo el juego funcione. Se manejan **dos ejes separados**:

- **Genética (permanente):** los rasgos que se heredan — colores, patrones, rareza cosmética. Es la "paleta" de lo que *puede* salir en una cría.
- **Salud / felicidad (transitoria, del cuidado):** define la **calidad de la tirada** — cuánto chance tenés de que salgan los rasgos raros de esa paleta.

**Fórmula conceptual:**
> Cría = genética del padre + genética de la madre, y la **salud al momento de cruzar** decide las probabilidades de sacar los rasgos raros.

**Consecuencias de diseño:**
- No podés cruzar un bicho descuidado y esperar magia. Tenés que llevarlo a su **pico de salud antes** de cruzar → se crea un ritual de cuidado intenso justo antes del payoff.
- Marca el ritmo natural del juego: cuidás varios días → llegás al pico → cruzás → repetís.
- **Cierra el círculo:** cuidar bien → mascota sana → mejores crías + más deseable para otros → más status e ingresos. El cuidado se vuelve el centro de la colección, la economía y el status.

## 5. Rareza: cosmética, no funcional

La rareza de las crías es **puramente cosmética** (looks), nunca funcional (mejores stats). Decisión deliberada:

- **Status visible:** una cría de color/patrón raro es un flex que todos ven de un vistazo. En un hub social, eso es el enganche.
- **Sin power creep ni pay-to-win:** si la rareza diera poder, en contexto blockchain/NFT se vuelve tóxico (el que tiene la cría rara "gana", las viejas quedan obsoletas). Cosmético es sostenible para siempre — podés agregar variantes infinitas sin desbalancear.
- **Inclusivo:** la mascota común de un casual sigue siendo linda y válida.

Es el mismo motor de Adopt Me (colores/neon raros), pero **ganado cuidando y cooperando, no pagando** una gacha.

## 6. Mascotas: cuántas tenés vs cuántas cuidás

Distinción clave para que el breeding (que **crea** mascotas) no colisione con el cuidado (que **limita** cuántas podés mantener):

- **Cuántas OWNés (colección):** muchas / ilimitado. Es el punto del juego.
- **Cuántas cuidás ACTIVAMENTE a la vez:** pocas. El cuidado debe seguir sintiéndose real y el decay offline debe ser manejable.

**Solución temática — cápsulas de estasis (cryo-pods marcianos):**
- Las mascotas que no cuidás activamente van a **estasis: congeladas, no decaen.** Son tu colección guardada.
- Sacás una de estasis para cuidarla al pico y cruzarla; las crías nacen y van directo a estasis.

**Números recomendados:**
- **Desde 0:** adoptás **1** mascota starter (elegís de las especies base marcianas).
- **Slots de cuidado activo:** arrancás con **1**, expandible a **2–3 máximo** (vía nivel de colonia).
- **Estasis (colección):** ilimitado o cap alto, congeladas.
- **Fuente de mascotas nuevas:** principalmente **criar**, no adoptar. La adopción de especies base es limitada/gateada, para que el breeding sea el motor real de la colección.

> ⚠️ Cambio respecto del MVP actual: hoy las mascotas inactivas *decaen*. En el diseño nuevo, las guardadas van **congeladas** — si no, criar mucho te condena.

## 7. Breeding: el registro asíncrono

El breeding no requiere que el otro jugador esté online. Modelo probado en blockchain (**CryptoKitties**): cruzás con la *mascota* de otro, no con el *jugador*.

**Registro de breeding ("criadero"):**
- Publicás tu mascota (bien cuidada) como disponible para cruzar. Su salud se **"congela"** en ese momento (peinás al pico, listás, queda disponible a esa calidad).
- Cualquier otro jugador, en cualquier momento, cruza la suya con la tuya — **aunque estés offline.**
- Él se lleva la cría; opcionalmente vos **cobrás una tarifa** en coins.

**La tarifa (opcional, perilla de tuning):** mercado de dos lados — el que cruza paga, el dueño cobra. Sirve como **sink** de moneda (anti-inflación) y como **incentivo** a mantener una mascota sana y deseable (ingreso pasivo). Si enfría el vibe, se puede hacer cruce gratis; el mecanismo importante es cruzar-con-mascota-offline, la tarifa es condimento.

## 8. La colonia: compartida + colección personal

Resuelve la tensión entre cooperación (breeding necesita partners) y competencia (leaderboard):

- **Cooperás** para hacer crecer la **colonia marciana común** (todos aportan, todos la ven crecer y ponerse linda + subir de nivel).
- **Competís / flexeás** con tu **colección personal** de crías raras (ahí va el leaderboard).

**Cómo contribuye un jugador (todo asíncrono):**
1. **Automática (población):** cada cría que criás se suma a la población global de Marte (número/visual que todos ven crecer).
2. **Directa P2P (el registro de breeding):** tu genética se propaga por la colonia; otros construyen sus linajes sobre tus mascotas.
3. **Opcional (proyectos comunales):** metas colectivas async ("la colonia necesita 100 mascotas para desbloquear el invernadero").

**Leaderboard:** rankear por **nivel de colonia / prestigio de colección**, **NO por dinero.** El dinero es un recurso, no un trofeo (rankear por plata premia acumular y huele a rich-get-richer).

## 9. Economía

- **Ingreso pasivo por felicidad** (ya existe en el MVP): más feliz la mascota, más moneda.
- **Sinks:** tarifa de breeding (opcional), adopción de slots, ítems de cuidado/shop.
- **Valor real = rareza cosmética.** La escasez de looks es lo que da status y (a futuro) valor de trade.
- Mantener el balance sink/source es clave si hay ingreso pasivo (evitar inflación).

## 9b. Meteoritos — recompensa sorpresa

Reskin marciano del clásico "spin/ruleta": en vez de girar una ruleta, un **meteorito cae** en la colonia con una recompensa **adentro**. El jugador va, lo abre, y sale la sorpresa (moneda, ítem de cuidado, ticket, cosmético, o una chance de algo raro).

- Es un **pool de recompensas ponderado** (común / raro / jackpot) — el componente ya existe en el código (el viejo "spin wheel"); solo cambia la presentación a meteorito.
- **Delivery:** caen por streak de login, milestones, o eventos.
- **Por qué funciona:** es el patrón de *recompensa variable / caja sorpresa* (la excitación de la gacha), **pero gratis/ganado, no pago** — coherente con el pilar de no pay-to-win. Y encaja temáticamente perfecto con Marte (lluvia de meteoritos).

## 10. Modelo multiplayer: async-first

> Regla de oro: todo lo social funciona con el otro jugador **offline**. Coincidir online = bonus más jugoso, nunca requisito.

- La **posición** de las mascotas se simula **local** en cada cliente (contra el avatar del dueño, que el comms de DCL sincroniza nativo). Cero costo de red por movimiento.
- La **metadata** liviana (especie, mood, tamaño, follow, presencia) va por el **servidor autoritativo**.
- **Breeding, colonia y leaderboard** son asíncronos (registro sembrado con mascotas del sistema + listadas por players, así funciona desde el día 1 con 0 jugadores online).

## 11. Qué copiar y qué no (referentes)

| Juego | Qué robar | Qué NO |
|-------|-----------|--------|
| **Tamagotchi** | Decay real + offline, culpa/retorno, cuidado→evolución | Muerte permanente dura; profundidad nula |
| **Pou** | Acciones de cuidado atadas a objetos, casual | Que se agote en días (le falta motor de largo plazo) |
| **Adopt Me** | Rareza cosmética como status, breeding como social | Gacha/huevos pagos, trading tóxico, pay-to-win |
| **Niche** | Genética real para sostener una colonia | Complejidad de supervivencia hardcore |
| **Pokémon (breeding)** | Herencia de rasgos, "shiny hunting" | IVs/competitivo funcional |
| **Animal Crossing** | Meta cozy: hacer crecer/embellecer tu lugar, retorno diario | Ritmo tan lento que aburre sin hook |

---

# PARTE B — MVP de 2 meses + validación

## 12. El MVP como experimento

El MVP no es "una versión chica del juego": es un **experimento con una hipótesis y un umbral de éxito definido de antemano**. Se lanza sin todo terminado, pero con **un loop completo y pulido** que valida el enganche. La ventaja: **PostHog ya está integrado**, así que el aparato de medición está listo.

**Principio:** construir la parte más **riesgosa**, no la más fácil.
- El **cuidado** es género probado y ya está construido → riesgo bajo.
- El **breeding por rareza cosmética + colección** es el diferenciador y lo que no sabemos si engancha → **esto es lo que hay que validar.**

## 13. La hipótesis a validar

> **"¿Los jugadores cuidan a su mascota Y vuelven para cruzar y coleccionar crías raras?"**

Todo lo que no sirva para probar esto se **difiere** hasta que la data lo pida.

## 14. Alcance del MVP

**En scope — el vertical slice que se siente completo:**
1. Re-tematizar a Marte el loop de cuidado que ya existe.
2. **Breeding + genética** (el corazón nuevo): 2 mascotas → cría que hereda rasgos **visibles** (color/patrón), con rareza influida por la salud al cruzar.
3. **Registro de breeding async, sembrado:** el pool arranca con mascotas "salvajes"/del sistema + las que listan los players, así hay con quién cruzar desde el día 1.
4. **Vista de colección (estasis):** ver tus crías — el payoff/status.

**Fuera de scope (gateado detrás de la validación):**
- Colonia común / población global / "Marte más lindo" → diferido (es el meta de largo plazo).
- Leaderboard, trading, tarifas de cruce, tiers de shop → mínimo o ausente.
- Achievements / spin / streak → se dejan si ya están y son gratis; si no, se cortan.

**El vertical slice, en una frase:**
> Adoptar → cuidar hasta que esté sano → cruzar → sacar una cría visiblemente rara → verla en tu colección.

## 15. Plan de concept validation (PostHog)

**El funnel del core a instrumentar:**
```
session started → adoptó pet → 1er cuidado → llegó a nivel de breeding
   → completó 1er cruce → volvió al día siguiente → cruzó 2da vez
```

**Las 3 métricas que deciden si el juego "prende":**
1. **Retención D1/D7** — ¿vuelven? (ya existe el evento `session started`). *La señal #1.*
2. **% que cruza al menos 1 vez** — ¿se usa el diferenciador?
3. **% que cruza más de una vez** — ¿la colección genera deseo? *La que valida el hook real.*

**Go/no-go pre-definido (ejemplo, números a fijar antes de lanzar):**
> "Si D7 > X% **y** más del Y% de los que vuelven cruzan ≥2 veces → seguimos desarrollando (colonia, trading, etc.). Si no → pivoteamos o paramos."

Ese es el "indicador" para decidir si vale la pena seguir — definido y medible, no a ojo.

## 16. Timeline aproximado (ajustable al equipo/arte)

| Semana | Foco |
|--------|------|
| 1–2 | Re-tema Marte + adaptar el cuidado existente; diseñar el **modelo de datos de genética** |
| 3–5 | Breeding + herencia + render de rasgos cosméticos (el sistema nuevo, lo más pesado) |
| 6 | Registro async (sembrado + listado de players) + vista de colección/estasis |
| 7 | Instrumentar el funnel en PostHog + pulido del vertical slice |
| 8 | Soft launch + buffer |

## 17. Preguntas abiertas / a definir en tuning

- **Genética:** cuántos genes/rasgos, cómo es la herencia (dominante/recesivo à la Mendel, o mezcla de probabilidades), cuántos tiers de rareza.
- **Curva de salud→rareza:** cuánto pesa la salud en las probabilidades.
- **Números de cuidado:** tasas de decay, cuánto cuesta llegar al pico, cooldown de breeding.
- **Umbrales go/no-go concretos** (X% e Y%) — fijar antes del lanzamiento.
- **¿La base personal es una parcela/escena propia en Marte, o una zona dentro de una escena compartida?** (decisión técnica-DCL pendiente).
- **Tarifa de breeding:** ¿on/off en el MVP? ¿monto?
- **Título del juego.**

---

*Documento vivo — se actualiza a medida que se cierran decisiones de tuning y llega la data de validación.*
