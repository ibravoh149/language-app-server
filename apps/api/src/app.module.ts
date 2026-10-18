import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { RequestLoggerMiddleware } from './common/request-logger.middleware';
import { DatabaseModule } from './database/database.module';
import { PlacementModule } from './placement/placement.module';
import { RoleplayModule } from './roleplay/roleplay.module';

@Module({
  imports: [
    // .env can live in apps/api or at the repo root (where .env.example is).
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env', '../../.env'] }),
    DatabaseModule,
    AuthModule,
    PlacementModule,
    RoleplayModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestLoggerMiddleware).forRoutes('*');
  }
}
