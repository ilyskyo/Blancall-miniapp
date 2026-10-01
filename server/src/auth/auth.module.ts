import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { AuthController, MeController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  imports: [StorageModule],
  controllers: [AuthController, MeController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}