import 'reflect-metadata';
import { defineConfig } from '@mikro-orm/postgresql';
import { Migrator } from '@mikro-orm/migrations';
import { join } from 'node:path';
import { config } from './config';
import { Agency, Agent, Lead, Message, Property, Task, AssistantRun, AssistantAction } from './entities';

export function buildOrmConfig() {
  return defineConfig({
    clientUrl: config.databaseUrl(),
    entities: [Agency, Agent, Lead, Message, Property, Task, AssistantRun, AssistantAction],
    extensions: [Migrator],
    migrations: {
      path: join(__dirname, 'migrations'),
      pathTs: join(__dirname, 'migrations'),
      glob: '!(*.d).{js,ts}',
      transactional: true,
      snapshot: false,
    },
    debug: false,
  });
}

export default buildOrmConfig;
