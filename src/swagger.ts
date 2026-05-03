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
      openapi: '3.0.0',
      info: {
        title: 'Transit API Wrapper — TUS Santander',
        version: VERSION,
        description:
          'API REST unificada para el Transporte Urbano de Santander (TUS). ' +
          'Envuelve Open Data Santander, la API en tiempo real de TUS, y datos estáticos ' +
          'en 37 endpoints limpios y coherentes.',
        contact: {
          name: 'ebroelevado',
          url: 'https://github.com/ebroelevado/transit-api-wrapper',
        },
      },
      servers,
      tags: [
        { name: 'Core', description: 'Health, discovery y catálogo' },
        { name: 'Stops', description: 'Paradas y búsqueda' },
        { name: 'Arrivals', description: 'Llegadas en tiempo real' },
        { name: 'Map', description: 'Datos geoespaciales (GeoJSON)' },
        { name: 'Trip', description: 'Planificador de viajes' },
        { name: 'Batch', description: 'Consultas múltiples en paralelo' },
        { name: 'Compare', description: 'Comparación de líneas' },
        { name: 'Time', description: 'Hora del servidor y ETD' },
        { name: 'Fares', description: 'Tarjetas y abonos TUS' },
        { name: 'Schedules', description: 'Horarios programados' },
        { name: 'Alerts', description: 'Alertas de servicio' },
        { name: 'DX', description: 'Developer experience' },
      ],
      paths: {},
    },
    apis: ['./src/routes/*.ts'],
  };
}

export const swaggerSpec = swaggerJsDoc(buildOptions());
