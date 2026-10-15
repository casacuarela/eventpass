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

## 🔐 Espacios Separados y Autenticación de Acceso

El sistema ahora cuenta con **dos áreas totalmente independientes** para garantizar la seguridad del evento y la privacidad financiera:

1. **🚪 Espacio Portería / Control en Puerta (Acceso con PIN de 4 cifras):**
   - **PIN por defecto:** `1234` (configurable por el administrador).
   - Diseñado específicamente para el staff en las puertas desde teléfonos móviles o tablets.
   - Incluye teclado táctil en pantalla y detector automático de 4 dígitos.
   - **Lo que ven los porteros:** Escáner de cámara, ingreso manual de código, conteo de personas ingresadas vs aforo, tarjeta gigante de resultado (Verde/Rojo/Amarillo) con sonido de alta intensidad y registro de sus últimos escaneos.
   - **Lo que NO pueden ver:** Oculta por completo las finanzas, recaudación de dinero, cancelación de boletos, edición del evento y la base de datos de compradores.

2. **👑 Espacio Administrador (Acceso con Contraseña):**
   - **Contraseña por defecto:** `admin123` (configurable en la pestaña de Ajustes).
   - Acceso total al Dashboard, métricas de recaudación en dinero, lista completa de asistentes, exportación a Excel, transferencias y anulación de boletos.
   - Permite cambiar el **PIN de porteros** y la **contraseña de administrador** en cualquier momento.
   - Incluye botón de acceso rápido para probar o abrir la portería.

---

## ⚡ Boletos Simplificados (Sin Nombre ni Cédula Obligatorios)

- **Ventas Inmediatas en Taquilla:** El nombre y la cédula ya no son requeridos. Si se dejan en blanco, el sistema asigna automáticamente identificadores amigables como `Portador Entrada (General) #5`.
- **Emisión en Lote / Múltiples Boletos:** Puedes emitir 1, 2, 3, 5 o 10 entradas de un solo clic. Cada una se generará con su propio código QR criptográfico único.

---

## 🛡️ ¿Cómo funciona la Protección Antifraude y contra Capturas de Pantalla?

1. **"Quemado" en Primer Uso (En Tiempo Real):**
   - En el milisegundo en que un QR es escaneado en puerta, el servidor lo marca como `used`. Si otra persona intenta entrar con una captura de pantalla de ese mismo QR, el sistema salta en **ROJO**:
     > 🛑 **¡ALERTA DE FRAUDE! BOLETO YA UTILIZADO**  
     > *Este boleto ya fue ingresado previamente a las 08:15 p.m. No se permite reingreso.*

2. **Sello Dinámico de Seguridad en Vivo (Anti-Screenshot):**
   - El boleto digital oficial cuenta con un **reloj digital en tiempo real con segundero continuo**, un indicador pulsante tipo radar y una **barra holográfica animada**.
   - Si una persona muestra una foto estática (JPG/PNG), el portero notará inmediatamente que el segundero no avanza y podrá exigir el enlace web original.

3. **Invalidación en Vivo en el Celular del Usuario (SSE):**
   - Si el asistente tiene su boleto abierto en su teléfono mientras el portero lo escanea, la pantalla de su celular cambia automáticamente en tiempo real a:
     > 🔴 **YA INGRESADO AL EVENTO (HH:MM)**  
     > e invalida el código de inmediato.

4. **Transferencias Seguras (Quema de Código Viejo):**
   - Al transferir un boleto, el QR anterior queda completamente destruido. Si el titular anterior intenta usar su captura de pantalla vieja, el escáner lo detecta como intento de fraude.

---

## 📋 Módulos Incluidos en la Aplicación

- **🚪 Control de Acceso Portería:** Vista enfocada 100% en escáner rápido, aforo en vivo y sonidos de alerta.
- **📊 Dashboard en Tiempo Real:** Métricas de aforo en vivo (% del recinto lleno), boletos emitidos, personas adentro, pendientes, recaudación en dinero y conteo de fraudes bloqueados.
- **➕ Emisión Express de Entradas:** Venta en segundos al portador o con datos, con emisión unitaria o en lotes.
- **🔄 Transferencia Segura de Boletos:** Permite cambiar el titular de un boleto no usado, invalidando el QR anterior y generando uno nuevo para el nuevo comprador.
- **🎫 Boleto Digital Prémium:** Diseño holográfico, reloj en vivo antifraude, botón para compartir por WhatsApp e impresión en PDF limpia.
- **👥 Lista de Asistentes:** Tabla completa con filtros por estado, buscador interactivo, botones de reingreso, transferencias y exportación directa a **Excel (CSV)**.
- **⚙️ Configuración del Evento:** Edita nombre, fecha, lugar, aforo, tipos de boleto, PIN de porteros y contraseña admin.
