
import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { LibSQLStore } from '@mastra/libsql';
import { DuckDBStore } from "@mastra/duckdb";
import { MastraCompositeStore } from '@mastra/core/storage';
import { Observability, MastraStorageExporter, MastraPlatformExporter, SensitiveDataFilter } from '@mastra/observability';
import { weatherWorkflow } from './workflows/weather-workflow';
import { caregiverDispatchWorkflow } from './workflows/caregiver-dispatch-workflow';
import { weatherAgent } from './agents/weather-agent';
import { gatekeeperAgent } from './agents/gatekeeper-agent';
import { extractionLoggingAgent } from './agents/extraction-logging-agent';
import { validationConfirmationAgent } from './agents/validation-confirmation-agent';
import { foodPhotoAgent } from './agents/food-photo-agent';
import { qaAgent } from './agents/qa-agent';
import { analysisAgent } from './agents/analysis-agent';
import { notificationAgent } from './agents/notification-agent';
import { caregiverAgent } from './agents/caregiver-agent';
import { toolCallAppropriatenessScorer, completenessScorer, translationScorer } from './scorers/weather-scorer';

export const mastra = new Mastra({
  workflows: { weatherWorkflow, caregiverDispatchWorkflow },
  agents: {
    weatherAgent,
    gatekeeperAgent,
    extractionLoggingAgent,
    validationConfirmationAgent,
    foodPhotoAgent,
    qaAgent,
    analysisAgent,
    notificationAgent,
    caregiverAgent,
  },
  scorers: { toolCallAppropriatenessScorer, completenessScorer, translationScorer },
  storage: new MastraCompositeStore({
    id: 'composite-storage',
    default: new LibSQLStore({
      id: "mastra-storage",
      url: "file:./mastra.db",
    }),
    domains: {
      observability: await new DuckDBStore().getStore('observability'),
    }
  }),
  logger: new PinoLogger({
    name: 'Mastra',
    level: 'info',
  }),
  observability: new Observability({
    configs: {
      default: {
        serviceName: 'mastra',
        exporters: [
          new MastraStorageExporter(), // Persists observability events to Mastra Storage
          new MastraPlatformExporter(), // Sends observability events to Mastra Platform (if MASTRA_PLATFORM_ACCESS_TOKEN is set)
        ],
        spanOutputProcessors: [
          new SensitiveDataFilter(), // Redacts sensitive data like passwords, tokens, keys
        ],
      },
    },
  }),
});
