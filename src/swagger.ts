import swaggerJsDoc from 'swagger-jsdoc';
import { VERSION, BASE_URL } from './config';
import { PORT } from './config';

function buildOptions(): swaggerJsDoc.Options {
  const servers = [];
  if (process.env.BASE_URL) {
    servers.push({ url: process.env.BASE_URL, description: 'Producción' });
  }
  servers.push({ url: `http://localhost:${PORT}`, description: 'Desarrollo local' });

  return {
    definition: {
      openapi: '3.1.0',
      info: {
        title: 'SANTANDER TUS API',
        version: VERSION,
        description: `
Una API REST unificada, moderna y rápida para interactuar con los servicios del Transporte Urbano de Santander (TUS).

Esta API envuelve múltiples fuentes de datos (Open Data Santander y la API Legacy del TUS) para ofrecer una experiencia de desarrollo limpia, consistente y predecible.

## 🚀 Conceptos Core

### Formato de Respuesta
Todas las respuestas (incluyendo errores) devuelven JSON. Cuando ocurre un error, el formato unificado es:
\`\`\`json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request parameters",
    "details": [...]
  }
}
\`\`\`

### Fuentes de Datos y Caché
La API es un proxy inteligente:
- **Open Data Santander**: Datos estáticos (paradas, rutas). Se cachean en memoria agresivamente.
- **Legacy API**: Datos en tiempo real (estimaciones). La respuesta varía según la disponibilidad de esta API de terceros.

### Límites de Uso (Rate Limiting)
Para garantizar la estabilidad del servicio:
- **Global**: 500 peticiones por ventana de 5 minutos por IP.
- **Estricto (Planificador de viajes)**: 50 peticiones por minuto por IP.
Si superas los límites, recibirás un HTTP 429 (Too Many Requests).

### Paginación
Endpoints que devuelven listas extensas (ej. búsquedas) soportan paginación mediante \`limit\` y \`offset\`:
- \`limit\`: Máximo de items a devolver (por defecto 50).
- \`offset\`: Items a saltar (por defecto 0).
        `,
        contact: {
          name: 'ebroelevado',
          url: 'https://github.com/ebroelevado/transit-api-wrapper',
        },
      },
      servers,
      tags: [
        { name: 'Core', description: '🏥 **Salud y Descubrimiento**: Endpoints base para verificar el estado y explorar el catálogo de líneas.' },
        { name: 'Stops', description: '🚏 **Infraestructura de Paradas**: Búsqueda avanzada, geolocalización y detalles técnicos de los postes.' },
        { name: 'Arrivals', description: '🕒 **Tiempo Real**: Predicciones de llegada basadas en la red GPS de los autobuses.' },
        { name: 'Schedules', description: '📅 **Planificación**: Horarios programados y frecuencias teóricas.' },
        { name: 'Map', description: '🗺️ **Geolocalización**: Capas visuales y rutas completas en formato GeoJSON.' },
        { name: 'Trip', description: '🧭 **Navegación**: Algoritmos para planificar rutas entre dos puntos.' },
        { name: 'Batch', description: '⚡ **Optimización**: Consulta múltiples recursos en una sola petición.' },
        { name: 'Compare', description: '🔄 **Transbordos**: Utilidades para comparar líneas y encontrar puntos de conexión.' },
        { name: 'Alerts', description: '⚠️ **Estado del Servicio**: Incidencias, desvíos y noticias en tiempo real.' },
        { name: 'Fares', description: '💳 **Tarifas**: Información sobre abonos, precios y puntos de recarga.' },
        { name: 'Time', description: '⌚ **Sincronización**: Reloj maestro de la red TUS para cálculos de precisión.' },
        { name: 'DX', description: '💻 **Developer Experience**: Guías rápidas y códigos de error comunes.' },
      ],
      paths: {},
    },
    apis: ['./src/routes/*.ts', './src/docs/*.yml'],
  };
}

export const swaggerSpec = swaggerJsDoc(buildOptions());
