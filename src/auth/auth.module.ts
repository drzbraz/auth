import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import type { StringValue } from 'ms';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TokensService } from './tokens.service';
import {
  RefreshSession,
  RefreshSessionSchema,
} from './schemas/refresh-session.schema';

@Module({
  imports: [
    UsersModule,
    MongooseModule.forFeature([
      { name: RefreshSession.name, schema: RefreshSessionSchema },
    ]),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_ACCESS_SECRET'),
        signOptions: {
          expiresIn: configService.get<StringValue>('JWT_ACCESS_TTL', '15m'),
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, TokensService],
})
export class AuthModule {}
