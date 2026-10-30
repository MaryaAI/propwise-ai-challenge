import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module, ValidationPipe } from '@nestjs/common';
import { APP_GUARD, APP_PIPE } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AssistantModule } from './assistant/assistant.module';
import { AuthGuard } from './auth/auth.guard';
import { AuthModule } from './auth/auth.module';
import { config } from './config';
import { HealthController } from './health.controller';
import { LeadsModule } from './leads/leads.module';
import { buildOrmConfig } from './mikro-orm.config';
import { PropertiesModule } from './properties/properties.module';
import { TasksModule } from './tasks/tasks.module';

@Module({
  imports: [
    MikroOrmModule.forRootAsync({ useFactory: () => buildOrmConfig() }),
    JwtModule.registerAsync({
      global: true,
      useFactory: () => ({ secret: config.jwtSecret(), signOptions: { expiresIn: '12h' } }),
    }),
    AuthModule,
    LeadsModule,
    PropertiesModule,
    TasksModule,
    AssistantModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    },
  ],
})
export class AppModule {}
