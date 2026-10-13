# 🎟️ EventPass - Sistema de Gestión de Eventos & Control Antifraude

¡Bienvenido a tu sistema integral de gestión de eventos, emisión de boletos y control de acceso en tiempo real!

---

## 🚀 Cómo iniciar la aplicación

1. Abre una terminal de comandos en esta carpeta (`c:\Eventos`).
2. Ejecuta el comando:
   ```bash
   node server.js
   ```
   *(O si lo prefieres: `npm start`)*

3. Abre en tu navegador web:
   👉 **[http://localhost:3000](http://localhost:3000)**

---

## 📱 ¿Cómo usar el escáner en los celulares el día del evento?

Para que los porteros puedan validar las entradas desde sus teléfonos móviles:

1. Conecta la laptop donde corre el sistema y los teléfonos de los porteros a la **misma red Wi-Fi** (o comparte internet desde un teléfono mediante Zona Wi-Fi / Hotspot).
2. Averigua la IP local de tu laptop (abriendo la consola y escribiendo `ipconfig`, por ejemplo `192.168.1.15`).
3. En los celulares de los porteros, abren el navegador e ingresan a:
   👉 **`http://192.168.1.15:3000`**
4. ¡Listo! Hacen clic en la pestaña **"📷 Escáner Portería"**, aceptan el permiso de la cámara y pueden comenzar a escanear.

---

## 🛡️ ¿Cómo funciona la Protección Antifraude?

1. **Código Criptográfico Único por Boleto:**
   - Cada boleto emitido genera un identificador irrepetible (`TKT-XXXX-XXXX`) y un código QR de alta resolución con verificación digital.
2. **"Quemado" en Primer Uso (Validación en Tiempo Real):**
   - Cuando la persona llega a la puerta y el portero escanea el QR, la pantalla salta en **VERDE NEÓN** con un sonido armónico de bienvenida.
   - En ese mismo milisegundo, la base de datos cambia su estado a `INGRESADO` y registra la hora exacta.
3. **Bloqueo Inmediato de Copias y Capturas (WhatsApp):**
   - Si esa persona le mandó la captura de pantalla por WhatsApp a un amigo para que intente entrar después, cuando el segundo intente pasar con la misma imagen, la pantalla del portero salta en **ROJO PARPADEANTE** con un sonido de alarma estridente:
     > 🛑 **¡ALERTA DE FRAUDE! BOLETO YA UTILIZADO**  
     > *Este boleto ya ingresó previamente a las 08:15 p.m. por Juan Pérez.*
4. **Detección de Códigos Falsos:**
   - Si alguien intenta mostrar un código inventado o de otro evento, la app muestra una advertencia en **AMARILLO**:
     > ⚠️ **CÓDIGO NO VÁLIDO O FALSIFICADO**
5. **Transferencias Seguras (Quema y Re-emisión de QR):**
   - Si un asistente no puede ir y transfiere su boleto a otra persona, el sistema **destruye e invalida permanentemente el código QR viejo** y genera uno nuevo exclusivo para el nuevo comprador.
   - Si el dueño anterior intenta usar su captura de pantalla vieja en la entrada, la pantalla salta en **ROJO**:
     > 🛑 **¡ALERTA! BOLETO TRANSFERIDO (CÓDIGO VIEJO)**  
     > *Este código pertenecía a [Nombre Anterior], pero fue transferido a [Nuevo Titular]. El código viejo quedó invalidado.*

---

## 📋 Módulos Incluidos en la Aplicación

- **📊 Dashboard en Tiempo Real:** Métricas de aforo en vivo (% del recinto lleno), boletos emitidos, personas adentro, pendientes, recaudación en dinero y conteo de fraudes bloqueados.
- **➕ Emisión y Venta de Entradas:** Formulario rápido para registrar ventas con nombre, teléfono, documento, tipo de entrada (General, VIP, Preventa, Cortesía), precio y método de pago.
- **🔄 Transferencia Segura de Boletos:** Permite cambiar el titular de un boleto no usado, invalidando el QR anterior y generando uno nuevo para el nuevo comprador.
- **🎫 Boleto Digital Prémium:**
  - Diseño estilo pase holográfico para eventos.
  - Botón de **Compartir por WhatsApp**: Abre un mensaje directo personalizado con el enlace al boleto del cliente.
  - Botón de **Imprimir / Guardar en PDF** (aislado y limpio, sin fondos oscuros ni cortes).
- **📷 Portería / Escáner:** Visor de cámara en vivo con mira láser, soporte para cámara trasera de celulares, sonido con Web Audio API y casilla de búsqueda manual por si la pantalla del cliente está rota.
- **👥 Lista de Asistentes:** Tabla completa con filtros por estado, buscador interactivo, botones de reingreso, transferencias y exportación directa a **Excel (CSV)**.
- **⚙️ Configuración del Evento:** Edita el nombre del evento, la fecha, el lugar, el aforo y la moneda en cualquier momento sin perder datos.
