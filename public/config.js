// Configuración opcional. Déjala vacía para usar el broker del propio servidor de Tacto
// (o el broker público de prueba si la página se publica en GitHub Pages).
//
// Para usar tu propio broker (HiveMQ Cloud, EMQX, Mosquitto con WebSocket seguro…):
//   window.TACTO_CONFIG = { broker: 'wss://mi-broker.example.com:8884/mqtt' };
//
// Si la página del teléfono vive en otro sitio (por ejemplo, la del profesor), indica su dirección para el QR:
//   window.TACTO_CONFIG = { phoneUrl: 'https://profesor.github.io/tacto/' };
window.TACTO_CONFIG = window.TACTO_CONFIG || {};
